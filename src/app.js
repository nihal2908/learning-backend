import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

const app = express()

// for configuring cors settings
app.use(cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true,
}))

// for using json in our app, with a limit of size
app.use(express.json({
    limit: "16kb",
}))

// for url encoding and allowing nested objects in url
app.use(express.urlencoded({
    extended: true,
    limit: "16kb",
}))

// for saving static content on the server (temporarily)
app.use(express.static("public"))

// for configuring cookies
app.use(cookieParser())


// routes import
import userRouter from "./routes/user.routes.js"; 

// routes declaration
app.use("/api/v1/users", userRouter)

export { app }