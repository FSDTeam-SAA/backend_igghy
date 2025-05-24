import catchAsync from '../utilty/catchAsync.js';
import AppError from '../errors/AppError.js';
import { sendResponse } from '../utilty/helper.utilty.js';
import { Hub } from '../models/hubs.models.js';
import { User } from '../models/user.models.js';
import { Product } from '../models/product.models.js';
import { Transporter } from '../models/transporter.models.js';

// Get dashboard overview
export const getDashboardOverview = catchAsync(async (req, res) => {
    const totalHubs = await Hub.countDocuments();
    const deliverdProducts = await Product.countDocuments({ status: 'Received' });
    const totalProducts = await Product.countDocuments();

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'Dashboard overview retrieved successfully',
        data: { totalHubs, deliverdProducts, totalProducts },
    });
});

// Helper function to paginate and filter users
const fetchUsers = async (req, role) => {
    const { page = 1, limit = 10, search = '' } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    let query = { role };
    if (search) {
        query.$or = [
            { name: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
            { phone: { $regex: search, $options: 'i' } },
        ];
    }

    const users = await User.find(query)
        .populate('hubId', 'name')
        .skip(skip)
        .limit(limitNum);

    const total = await User.countDocuments(query);

    return {
        users,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
    };
};

// Get hub manager list
export const getHubManagers = catchAsync(async (req, res) => {
    const { users, total, page, limit, totalPages } = await fetchUsers(req, 'hubManager');

    const formattedUsers = users.map((user) => ({
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        joiningDate: user.createdAt,
        assignedHub: user.hubId ? user.hubId.name : null,
    }));

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'Hub manager list retrieved successfully',
        data: {
            formattedUsers,
            pagination: { total, page, limit, totalPages }
        },
    });
});

// Get hub list
export const getHubs = catchAsync(async (req, res) => {
    const { page = 1, limit = 10, search = '' } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    let query = {};
    if (search) {
        query.name = { $regex: search, $options: 'i' };
    }

    const hubs = await Hub.find(query)
        .populate('managerId', 'name email phone')
        .skip(skip)
        .limit(limitNum);

    const total = await Hub.countDocuments(query);

    const formattedHubs = hubs.map((hub) => ({
        hubName: hub.name,
        assignedManager: hub.managerId ? hub.managerId.name : null,
        assignedDate: hub.createdAt,
        email: hub.managerId ? hub.managerId.email : null,
        phone: hub.managerId ? hub.managerId.phone : null,
        _id: hub._id
    }));

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'Hub list retrieved successfully',
        data: {
            formattedHubs,
            pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) }
        },
    });
});

// Add new hub manager
export const addHubManager = catchAsync(async (req, res) => {
    const { name, email, phone, password, confirmPassword, hubId } = req.body;

    if (password !== confirmPassword) {
        throw new AppError(400, 'Passwords do not match');
    }

    const existingUser = await User.findOne({ email }).select('name email phone role hubId')
    if (existingUser) {
        throw new AppError(400, 'Email already in use');
    }

    const newUser = await User.create({
        name,
        email,
        phone,
        password,
        role: 'hubManager',
        hubId,
        isVerified: true
    });

    const hub = await Hub.findById(hubId);
    if (!hub) {
        throw new AppError(404, 'Hub not found');
    }

    await hub.updateOne({ managerId: newUser._id });

    sendResponse(res, {
        statusCode: 201,
        success: true,
        message: 'Hub manager added successfully',
        data: newUser,
    });
});

// Add new hub
export const addHub = catchAsync(async (req, res) => {
    const { hubName, coordinates } = req.body;

    const existingHub = await Hub.findOne({ name: hubName });
    if (existingHub) {
        throw new AppError(400, 'Hub name already exists');
    }

    const newHub = await Hub.create({ name: hubName, coordinates });

    sendResponse(res, {
        statusCode: 201,
        success: true,
        message: 'Hub added successfully',
        data: newHub,
    });
});

// Edit hub manager
export const editHubManager = catchAsync(async (req, res) => {
    const { userId } = req.params;
    const { name, email, phone, password, confirmPassword, hubId } = req.body;

    const user = await User.findById(userId);
    if (!user) {
        throw new AppError(404, 'User not found');
    }

    if (password && password !== confirmPassword) {
        throw new AppError(400, 'Passwords do not match');
    }

    const updateData = {};
    if (name) updateData.name = name;
    if (email) {
        const existingUser = await User.findOne({ email }).select('name email phone role hubId');
        if (existingUser && existingUser._id.toString() !== userId) {
            throw new AppError(400, 'Email already in use');
        }
        updateData.email = email;
    }
    if (phone) updateData.phone = phone;
    if (password) updateData.password = password;
    if (hubId) updateData.hubId = hubId;

    const updatedUser = await User.findByIdAndUpdate(userId, updateData, { new: true });

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'Hub manager updated successfully',
        data: updatedUser,
    });
});

export const deleteUser = catchAsync(async (req, res) => {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
        throw new AppError(404, 'User not found');
    }

    await User.deleteOne({ _id: userId });

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'User deleted successfully',
        data: null,
    });
});

// Get all Transporter
export const getAllTransporters = catchAsync(async (req, res) => {
    const { page = 1, limit = 10, search = '' } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    let query = { status: 'on the way' };
    if (search) {
        query.$or = [
            { name: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
        ];
    }

    const transporters = await Transporter.find(query)
        .populate('transporterId fromHubId toHubId', 'name email phone')
        .skip(skip)
        .limit(limitNum);

    const total = await Transporter.countDocuments(query);

    const formattedTransporters = transporters.map((transporter) => ({
        id: transporter?.transporterId?._id,
        name: transporter?.transporterId?.name,
        email: transporter?.transporterId?.email,
        phone: transporter?.transporterId?.phone,
        fromHub: transporter?.fromHubId?.name,
        toHub: transporter?.toHubId?.name,
        status: transporter.status,
    }));

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'Transporter list retrieved successfully',
        data: {
            formattedTransporters,
            pagination: {
                total,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(total / limitNum),
            }
        },
    });
});

// Total delivered products for a hub
export const getTopReciverHubCount = catchAsync(async (req, res) => {
    const { month } = req.query;

    if (!month || !/^\d{2}-\d{4}$/.test(month)) {
        throw new AppError(400, 'Valid month format required (MM-YYYY)');
    }

    const [monthStr, yearStr] = month.split('-');
    const monthInt = parseInt(monthStr, 10) - 1;
    const yearInt = parseInt(yearStr, 10);

    const startDate = new Date(yearInt, monthInt, 1);
    const endDate = new Date(yearInt, monthInt + 1, 0, 23, 59, 59, 999);

    const hubStats = await Product.aggregate([
        {
            $match: {
                status: 'Received',
                'locations.timestamp': {
                    $gte: startDate,
                    $lte: endDate
                }
            }
        },
        {
            $group: {
                _id: '$toHubId',
                count: { $sum: 1 }
            }
        },
        {
            $lookup: {
                from: 'hubs',
                localField: '_id',
                foreignField: '_id',
                as: 'hubDetails'
            }
        },
        {
            $unwind: '$hubDetails'
        },
        {
            $project: {
                hubId: '$_id',
                hubName: '$hubDetails.name',
                deliveredCount: '$count',
                _id: 0
            }
        },
        {
            $sort: { deliveredCount: -1 }
        }
    ]);

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: `Hub delivery counts for ${month} retrieved successfully`,
        data: hubStats
    });
});

// Geet top sender and receiver hub
export const getTopHubStats = catchAsync(async (req, res) => {
    const { month } = req.query;

    if (!month || !/^\d{2}-\d{4}$/.test(month)) {
        throw new AppError(400, 'Month is required in MM-YYYY format');
    }

    const [monthStr, yearStr] = month.split('-');
    const monthInt = parseInt(monthStr, 10) - 1;
    const yearInt = parseInt(yearStr, 10);

    const startDate = new Date(yearInt, monthInt, 1);
    const endDate = new Date(yearInt, monthInt + 1, 0, 23, 59, 59, 999);

    // Common match condition
    const matchStage = {
        status: 'Received',
        'locations.timestamp': { $gte: startDate, $lte: endDate }
    };

    // Receiver aggregation
    const topReceivers = await Product.aggregate([
        { $match: matchStage },
        {
            $group: {
                _id: '$toHubId',
                totalReceived: { $sum: 1 }
            }
        },
        {
            $lookup: {
                from: 'hubs',
                localField: '_id',
                foreignField: '_id',
                as: 'hub'
            }
        },
        { $unwind: '$hub' },
        {
            $project: {
                hubId: '$_id',
                hubName: '$hub.name',
                totalProduct: '$totalReceived',
                _id: 0
            }
        },
        { $sort: { totalProduct: -1 } },
        { $limit: 5 }
    ]);

    // Sender aggregation
    const topSenders = await Product.aggregate([
        { $match: matchStage },
        {
            $group: {
                _id: '$fromHubId',
                totalSent: { $sum: 1 }
            }
        },
        {
            $lookup: {
                from: 'hubs',
                localField: '_id',
                foreignField: '_id',
                as: 'hub'
            }
        },
        { $unwind: '$hub' },
        {
            $project: {
                hubId: '$_id',
                hubName: '$hub.name',
                totalProduct: '$totalSent',
                _id: 0
            }
        },
        { $sort: { totalProduct: -1 } },
        { $limit: 5 }
    ]);

    const maxLength = Math.max(topReceivers.length, topSenders.length);
    const combinedHubList = [];

    for (let i = 0; i < maxLength; i++) {
        combinedHubList.push({
            topReceiverHub: topReceivers[i]?.hubName || null,
            totalReceived: topReceivers[i]?.totalProduct || 0,
            topSenderHub: topSenders[i]?.hubName || null,
            totalSent: topSenders[i]?.totalProduct || 0
        });
    }


    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: `Top receiver and sender hubs for ${month} retrieved successfully`,
        data: combinedHubList
    });
});

// Get mothly delivery count for a hub
export const getMonthlyDeliveredProducts = catchAsync(async (req, res) => {

    const year = parseInt(req.query.year) || new Date().getFullYear();
    const startOfYear = new Date(`${year}-01-01T00:00:00.000Z`);
    const endOfYear = new Date(`${year}-12-31T23:59:59.999Z`);

    const monthlyData = await Product.aggregate([
        {
            $match: {
                status: 'Received',
                createdAt: {
                    $gte: startOfYear,
                    $lte: endOfYear
                }
            }
        },
        {
            $group: {
                _id: { $month: '$createdAt' },
                totalDelivered: { $sum: 1 }
            }
        },
        {
            $project: {
                month: '$_id',
                totalDelivered: 1,
                _id: 0
            }
        },
        {
            $sort: { month: 1 }
        }
    ]);

    const monthNames = [
        'Jan', 'Feb', 'Mar', 'April', 'May', 'June',
        'July', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];

    const fullMonthlyData = monthNames.map((name, index) => {
        const monthData = monthlyData.find(item => item.month === index + 1);
        return {
            month: name,
            totalDelivered: monthData ? monthData.totalDelivered : 0
        };
    });

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: `Monthly delivered products for ${year} retrieved successfully`,
        data: fullMonthlyData
    });
});



