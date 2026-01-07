import { asyncHandler } from "../utils/aysncHandler.js";
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import { User } from "../models/user.model.js"
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import jwt from "jsonwebtoken";


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
    if(!req.body){
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
        throw new ApiError(400, "All fields are required hai")
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
            $set:{refreshToken: undefined}
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


export { 
    registerUser,
    loginUser,
    logoutUser,
    refreshAccessToken,
}