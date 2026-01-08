import { asyncHandler } from "../utils/aysncHandler.js";
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import { User } from "../models/user.model.js"
// import { Video } from "../models/video.model.js"
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";


const generateAccessAndRefreshToken = async(userId) => {
    try{
        const user = await User.findById(userId);

        if (!user) {
            throw new ApiError(404, "User not found");
        }

        const accessToken = user.generateAccessToken();
        const refreshToken = user.generateRefreshToken();

        user.refreshToken = refreshToken;

        await user.save({validateBeforeSave: false})

        return {accessToken, refreshToken};
    } catch (error) {
        throw new ApiError(500, "Something went wrong with token generation")
    }
}


const registerUser = asyncHandler( async (req, res) => {
    // get user details from body
    // check if request body is empty.
    if(!req.body || Object.keys(req.body).length === 0){
        throw new ApiError(400, "All fields are required")
    }

    const {fullName, email, username, password} = req.body
    
    // validation (whether all fields are present)
    if (
        [fullName, username, email, password]
        .some(field => !field || field?.trim() === "")
    ) {
        throw new ApiError(400, "All fields are required")
    }

    // check if user already exists
    const existedUser = await User.findOne({
        $or: [{ username }, { email }]
    })
    
    if(existedUser){
        throw new ApiError(409, "User with email or username exists")
    }

    // check for avatar, cover image
    const avatarLocalPath = !req.files?.avatar ? null : req.files?.avatar[0]?.path
    const coverImageLocalPath = !req.files?.coverImage ? null : req.files?.coverImage[0]?.path
    
    if(!avatarLocalPath) {
        throw new ApiError(400, "Avatar file is required")
    }

    // uplaod images to cloudinary
    const avatar = await uploadOnCloudinary(avatarLocalPath)
    const coverImage = await uploadOnCloudinary(coverImageLocalPath)
    
    if(!avatar){
        throw new ApiError(400, "Avatar file is required")
    }

    // create user object with all required fields - create entry in DB
    const user = await User.create({
        fullName,
        email,
        username: username.toLowerCase(),
        avatar: avatar.url,
        coverImage: coverImage?.url || "",
        password,
    })

    // check for user creation
    // remove password and refresh token field from object
    const createdUser = await User.findById(user._id).select(
        "-password -refreshToken"
    )

    if(!createdUser){
        throw new ApiError(500, "Something went wrong during registering")
    }

    // return user oject
    return res.status(201).json(
        new ApiResponse(200, createdUser, "User registered successfully")
    )
})


const loginUser = asyncHandler( async (req, res) => {
    // get credentials from body
    // check if request body is empty.
    if(!req.body || Object.keys(req.body).length === 0){
        throw new ApiError(400, "All fields are required")
    }

    // get username password
    const {username, password} = req.body
    
    // validation (whether all fields are present)
    if ([username, password].some(field => !field || field?.trim() === "")) {
        throw new ApiError(400, "All fields are required")
    }

    // find the user
    const user = await User.findOne({username})
    
    if(!user){
        throw new ApiError(409, "Invalid user credentials")
    }

    // password check
    const isPasswordCorrect = await user.isPasswordCorrect(password)

    if(!isPasswordCorrect){
        throw new ApiError(401, "Invalid user credentials")
    }

    // access and refresh token generation
    const {accessToken, refreshToken} = await generateAccessAndRefreshToken(user._id)

    const loggedInUser = await User.findById(user._id).select("-password -refreshToken")
    
    // send token in secure cookie
    const options = {
        httpOnly: true,
        secure: true,
    }

    return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
        new ApiResponse(
            200, 
            {
                user: loggedInUser,
                accessToken,
                refreshToken
            },
            "User logged in successfully"
        )
    )

})


const logoutUser = asyncHandler(async (req, res) => {
    // update the user with the id from middleware
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $unset:{
                refreshToken: 1
            }
        },
        {
            new: true,
        }
    )

    const options = {
        httpOnly: true,
        secure: true,
    }

    // clear cookies 
    return res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .json(
        new ApiResponse(200, {}, "User logged out")
    )
})


const refreshAccessToken = asyncHandler( async (req, res) => {
    if ((!req.cookies || !req.cookies.refreshToken) && (!req.body || !req.body.refreshToken)) {
        throw new ApiError(401, "Refresh token missing");
    }
    
    const incomingRefreshToken = await req.cookies.refreshToken || req.body.refreshToken
    
    if(!incomingRefreshToken){
        throw new ApiError(401, "Unauthorized request");
    }

    const decodedToken = jwt.verify(
        incomingRefreshToken,
        process.env.REFRESH_TOKEN_SECRET,
    )

    if(!decodedToken){
        throw new ApiError(401, "Invalid refresh token")
    }

    const user = await User.findById(decodedToken._id)

    if(!user){
        throw new ApiError(401, "Invalid refresh token")
    }

    if(incomingRefreshToken !== user.refreshToken){
        throw new ApiError(401, "Invalid refresh token")
    }

    const {
        accessToken: newAccessToken, 
        refreshToken: newRefreshToken
    } = await generateAccessAndRefreshToken(user._id)

    const options = {
        httpOnly: true,
        secure: true,
    }

    return res
    .status(200)
    .cookie("accessToken", newAccessToken, options)
    .cookie("refreshToken", newRefreshToken, options)
    .json(
        new ApiResponse(
            200, 
            {
                accessToken: newAccessToken,
                refreshToken: newRefreshToken
            },
            "Access token refreshed"
        )
    )
})


const changePassword = asyncHandler( async (req, res) => {
    if(!req.body || Object.keys(req.body).length === 0){
        throw new ApiError(400, "All fields are required")
    }
    
    const {currentPassword, newPassword} = req.body;
    if(!currentPassword || !newPassword){
        throw new ApiError(400, "All fields are required")
    }

    const user = await User.findById(req.user?._id)
    const isPasswordCorrect = await user.isPasswordCorrect(currentPassword);

    if(!isPasswordCorrect){
        throw new ApiError(400, "Incorrect current password")
    }

    user.password = newPassword;
    await user.save({validateBeforeSave: true});

    return res
    .status(200)
    .json(
        new ApiResponse(200, {}, "Password changed successfully")
    )
})


const getCurrentUser = asyncHandler( async (req, res) => {
    return res
    .status(200)
    .json(
        new ApiResponse(
            200, 
            req.user, 
            "Current user fetched successfully"
        )
    )
})


const updateUserDetails = asyncHandler(async (req, res) => {
    if(!req.body || Object.keys(req.body).length === 0){
        throw new ApiError(400, "Required fields cannot be empty")
    }

    const {fullName, email} = req.body;

    if(!fullName || !email){
        throw new ApiError(400, "Required fields cannot be empty")
    }

    const user = await User.findByIdAndUpdate(
        req.user._id,
        {
            fullName,
            email,
        },
        {new: true},
    )
    .select("-password -refreshToken")

    return res
    .status(200)
    .json(new ApiResponse(
        200,
        user,
        "User details updatd successfully"
    ));
})


const updateUserAvatar = asyncHandler( async (req, res) => {
    if(!req.file){
        throw new ApiError(400, "Avatar file is missing")
    }

    const avatarLocalPath = req.file?.path;

    const avatar = await uploadOnCloudinary(avatarLocalPath)
    if(!avatar || !avatar.url){
        throw new ApiError(500, "Avatar upload failed")
    }

    const user = await User.findByIdAndUpdate(
        req.user._id,
        {
            $set: {
                avatar: avatar.url,
            }
        },
        {new: true}
    ).select("-password -refreshToken");

    if(!user){
        throw new ApiError(500, "Error while updating user avatar")
    }

    return res
    .status(200)
    .json(
        new ApiResponse(
            200, 
            user,
            "User avatar updated successfully"
        )
    );
})


const updateUserCoverImage = asyncHandler( async (req, res) => {
    if(!req.file){
        throw new ApiError(400, "Cover image file is missing")
    }

    const coverImageLocalPath = req.file?.path;

    const coverImage = await uploadOnCloudinary(coverImageLocalPath)
    if(!coverImage || !coverImage.url){
        throw new ApiError(500, "Cover Image upload failed")
    }

    const user = await User.findByIdAndUpdate(
        req.user._id,
        {
            $set: {
                coverImage: coverImage.url,
            }
        },
        {new: true}
    ).select("-password -refreshToken");

    if(!user){
        throw new ApiError(500, "Error while updating cover image")
    }

    return res
    .status(200)
    .json(
        new ApiResponse(
            200, 
            user,
            "Cover Image updated successfully"
        )
    );
})


const getUserChannelProfile = asyncHandler( async (req, res) => {
    if(!req.params){
        throw new ApiError(400, "Channel name required")
    }

    const {username} = req.params;
    if(!username?.trim()){
        throw new ApiError(400, "Channel name required")
    }

    const userChannelProfile = await User.aggregate([
        {
            $match: {
                username: username?.toLowerCase(),
            }
        },
        {
            $lookup: {
                from: "subscriptions",
                foreignField: "channel",
                localField: "_id",
                as: "subscribers"
            }
        },
        {
            $lookup: {
                from: "subscriptions",
                foreignField: "subscriber",
                localField: "_id",
                as: "subscribedTo"
            }
        },
        {
            $addFields: {
                subscribersCount: {
                    $size: "$subscribers",
                },
                channelsSubscribedToCount: {
                    $size: "$subscribedTo",
                },
                isSubscribed: {
                    $cond: {
                        if: {
                            $in: [req.user?._id, "$subscribers.subscriber"]
                        },
                        then: true,
                        else: false,
                    }
                }
            }
        },
        {
            $project: {
                fullName: 1,
                username: 1,
                avatar: 1,
                coverImage: 1,
                email: 1,
                createdAt: 1,
                subscribersCount: 1,
                channelsSubscribedToCount: 1,
                isSubscribed: 1,
                _id: 0,
            }
        }
    ])

    if(!userChannelProfile?.length){
        throw new ApiError(400, "Channel does not exist")
    }

    return res
    .status(200)
    .json(
        new ApiResponse(
            200, 
            userChannelProfile[0],
            "User channel details fetched successfully"
        )
    )
})


const getUserWatchHistory = asyncHandler( async (req, res) => {
    const user = await User.aggregate([
        {
            $match: {
                _id: new mongoose.Types.ObjectId(req.user?._id)
            }
        },
        {
            $lookup: {
                from: "videos",
                localField: "watchHistory",
                foreignField: "_id",
                as: "watchHistory",
                pipeline: [
                    {
                        $lookup: {
                            from: "users",
                            localField: "owner",
                            foreignField: "_id",
                            as: "owner",
                            pipeline: [
                                {
                                    $project: {
                                        fullName: 1,
                                        username: 1,
                                        avatar: 1,
                                    }
                                }
                            ]
                        }
                    },
                    {
                        $addFields: {
                            owner: {
                                $first: "$owner"
                            }
                        }
                    }
                ]
            }
        }
    ]);
    
    if(!user){
        throw new ApiError(400, "User history not found")
    }

    return res
    .status(200)
    .json(
        new ApiResponse(
            200, 
            user[0].watchHistory,
            "User watch history fetched successfully"
        )
    )
})


export { 
    registerUser,
    loginUser,
    logoutUser,
    refreshAccessToken,
    changePassword,
    getCurrentUser,
    updateUserDetails,
    updateUserAvatar,
    updateUserCoverImage,
    getUserChannelProfile,
    getUserWatchHistory,
}