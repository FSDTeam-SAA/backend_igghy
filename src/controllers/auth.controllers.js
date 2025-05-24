import catchAsync from '../utilty/catchAsync.js';
import validation from '../utilty/validation_check.js';
import AppError from '../errors/AppError.js';
import { sendResponse, generateVerificationCode, sendVerificationCode, sendPasswordResetCode } from '../utilty/helper.utilty.js';
import { User } from '../models/user.models.js';
import jwt from 'jsonwebtoken';

// Register
export const registerStep1 = catchAsync(async (req, res) => {
    const { name, email, password, phone } = req.body;

    if (!name || !email || !password) {
        throw new AppError(400, 'All fields are required');
    }

    if(!validation.isValidEmail(email)){
        throw new AppError(422, "Not a valid email format!");
    }

    // if(!validation.isStrongPassword(password)) {
    //     throw new AppError(422, "Weak password!");
    // }

    if (await User.findOne({ email })) {
        throw new AppError(400, 'Email already in use');
    }

    const verificationCode = generateVerificationCode();
    const user = new User({
        name,
        email,
        password,
        phone,
        verificationCode,
    });

    await user.save();

    await sendVerificationCode(email, verificationCode);

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'Verification code sent to email',
        data: { userId: user._id },
    });
});

// Verify Registration
export const registerStep2 = catchAsync(async (req, res) => {
    const { userId, code } = req.body;

    if (!userId || !code) {
        throw new AppError(400, 'User ID and verification code are required');
    }

    const user = await User.findById(userId);
    if (!user) {
        throw new AppError(404, 'User not found');
    }

    if (user.isVerified) {
        throw new AppError(400, 'User already verified');
    }

    if (user.verificationCode !== code) {
        throw new AppError(400, 'Invalid verification code');
    }

    user.isVerified = true;
    user.verificationCode = undefined;
    await user.save();

    const { accessToken, refreshToken } = user.generateTokens();
    await user.save();

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'User verified successfully',
        data: { accessToken, refreshToken },
    });
});

// Login
export const login = catchAsync(async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        throw new AppError(400, 'Email and password are required');
    }

    const user = await User.findOne({ email });
    if (!user || !(await user.isPasswordValid(password))) {
        throw new AppError(401, 'Invalid email or password');
    }

    if (!user.isVerified) {

        return sendResponse(res,{
            statusCode: 200,
            success: true,
            message: 'User not verified, please verify',
            data: {userId: user._id}
        })
    }

    const { accessToken, refreshToken } = user.generateTokens();
    await user.save();

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'Login successful',
        data: { accessToken, refreshToken, userId: user._id, user: user },
    });
});

// Refresh Token
export const refreshToken = catchAsync(async (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
        throw new AppError(400, 'Refresh token is required');
    }

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(decoded.id);
    if (!user || user.refreshToken !== refreshToken) {
        throw new AppError(401, 'Invalid refresh token');
    }

    const { accessToken: newAccessToken, refreshToken: newRefreshToken } = user.generateTokens();
    await user.save();

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'Token refreshed successfully',
        data: { accessToken: newAccessToken, refreshToken: newRefreshToken },
    });
});

// Forgot Password
export const forgotPassword = catchAsync(async (req, res) => {
    const { email } = req.body;

    if (!email) {
        throw new AppError(400, 'Email is required');
    }

    const user = await User.findOne({ email });
    if (!user) {
        throw new AppError(404, 'User not found');
    }

    const resetCode = generateVerificationCode();
    user.resetCode = resetCode;
    await user.save();

    await sendPasswordResetCode(email, resetCode); 

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'Password reset code sent to email',
        data: null,
    });
});

// Verify Code
export const verifyResetCode = catchAsync(async (req, res) => {
    const { email, code } = req.body;

    if (!email || !code) {
        throw new AppError(400, 'Email and reset code are required');
    }

    const user = await User.findOne({ email });
    if (!user) {
        throw new AppError(404, 'User not found');
    }

    if (user.resetCode !== code) {
        throw new AppError(400, 'Invalid reset code');
    }

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'Reset code verified successfully',
        data: {
            userId: user._id
        },
    });
});

// Reset Password
export const resetPassword = catchAsync(async (req, res) => {
    const { userId, newPassword } = req.body;

    if (!userId || !newPassword) {
        throw new AppError(400, 'User ID and new password are required');
    }

    const user = await User.findById(userId);
    if (!user) {
        throw new AppError(404, 'User not found');
    }

    user.password = newPassword;
    user.resetCode = undefined;
    await user.save();

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'Password reset successfully',
        data: null,
    });
});