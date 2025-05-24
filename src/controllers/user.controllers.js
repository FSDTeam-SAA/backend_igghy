import catchAsync from '../utilty/catchAsync.js';
import AppError from '../errors/AppError.js';
import { sendResponse, generateUniqueCode, calculateDistance, calculateAmount, uploadOnCloudinary, createNotification } from '../utilty/helper.utilty.js';
import { Hub } from '../models/hubs.models.js';
import { User } from '../models/user.models.js';
import { Product } from '../models/product.models.js';
import { Request } from '../models/request.models.js';
import mongoose from 'mongoose';
import { Transporter } from '../models/transporter.models.js';

// Create a new shipment (User acting as shipper)
export const createShipment = catchAsync(async (req, res) => {
    const { fromHubId, toHubId, date, packageName, description, weight, measurement, email } = req.body;

    const userId = req.user._id;

    const receiverId = await User.findOne({ email }).select('_id');

    if (!receiverId) {
        throw new AppError(404, 'Receiver not found');
    }

    // Validate input
    if (userId.toString() === receiverId._id.toString()) {
        throw new AppError(400, 'Receiver cannot be the same as shipper');
    }

    if (!fromHubId || !toHubId || !date || !packageName || !weight || !measurement || !email) {
        throw new AppError(400, 'All fields are required');
    }

    // Fetch hubs with additional details
    const [fromHub, toHub] = await Promise.all([
        Hub.findById(fromHubId).select('name coordinates hubCode'),
        Hub.findById(toHubId).select('name coordinates hubCode'),
    ]);

    if (!fromHub || !toHub) {
        throw new AppError(404, 'Hub not found');
    }

    const receiver = await User.findOne({ _id: receiverId, role: 'user' });
    if (!receiver) {
        throw new AppError(404, 'Receiver not found');
    }

    const uniqueCode = await generateUniqueCode();
    const distance = calculateDistance(fromHub.coordinates, toHub.coordinates);
    const amount = calculateAmount(weight, distance);
    const transporterAmount = parseFloat(amount * 0.3);

    const product = new Product({
        uniqueCode,
        name: packageName,
        description,
        weight,
        measurement,
        fromHubId,
        toHubId,
        shipperId: req.user._id,
        receiverId: receiverId._id,
        amount,
        transporterAmount,
    });

    await product.save();

    // Notify receiver
    await createNotification(
        req.user._id,
        `New shipment created for you (${product.uniqueCode})`,
        'shipment',
        product._id,
        'Product'
    );

    const shipper = await User.findById(req.user._id);
    shipper.totalProductsShipped += 1;
    shipper.totalAmountShipped += amount;
    await shipper.save();

    const responseData = {
        uniqueCode: product.uniqueCode,
        product: {
            _id: product._id,
            uniqueCode: product.uniqueCode,
            name: product.name,
            description: product.description,
            weight: product.weight,
            measurement: product.measurement,
            status: product.status,
            amount: product.amount,
            transporterAmount: product.transporterAmount,
            fromHub: {
                _id: fromHub._id,
                name: fromHub.name,
                hubCode: fromHub.hubCode,
                coordinates: fromHub.coordinates,
            },
            toHub: {
                _id: toHub._id,
                name: toHub.name,
                hubCode: toHub.hubCode,
                coordinates: toHub.coordinates,
            },
            liveCoordinates: null,
            locations: [],
            createdAt: product.createdAt,
        },
        nextSteps: {
            action: 'print_barcode',
            required: true,
            hubCode: fromHub.hubCode,
            hubId: fromHub._id,
        },
    };

    sendResponse(res, {
        statusCode: 201,
        success: true,
        message: 'Shipment created successfully.',
        data: responseData,
    });
});
// Request to print a product (User acting as shipper)
export const requestPrint = catchAsync(async (req, res) => {
    const { productId, hubCode } = req.body;

    if (!productId || !hubCode) {
        throw new AppError(400, 'Product ID and Hub ID are required');
    }

    const hub = await Hub.findOne({ hubCode });
    if (!hub) {
        throw new AppError(404, 'Hub not found');
    }


    const product = await Product.findOne({ _id: productId, fromHubId: hub._id });
    if (!product) {
        throw new AppError(404, 'Product not found');
    }


    // Check if this product already has a pending print request
    const existingRequest = await Request.findOne({
        productId: product._id,
        status: 'pending'
    });

    if (existingRequest) {
        throw new AppError(400, 'A print request for this product is already pending');
    }

    // Create a request for hub manager to approve printing
    const request = new Request({
        productId: product._id,
        hubId: hub._id,
        userId: req.user._id,
        type: 'print',
    });
    await request.save();

    sendResponse(res, {
        statusCode: 201,
        success: true,
        message: 'Print request submitted to hub manager successfully.',
        data: {
            requestId: request._id,
        },
    });
});

// Get pending products for a hub (User acting as transporter)
export const getPendingProducts = catchAsync(async (req, res) => {
    const { fromHubId, toHubId } = req.body;

    if (!fromHubId || !toHubId) {
        throw new AppError(400, 'From and To hubs are required');
    }

    const pendingProducts = await Product.aggregate([
        {
            $match: {
                fromHubId: new mongoose.Types.ObjectId(fromHubId),
                toHubId: new mongoose.Types.ObjectId(toHubId),
                status: 'Pending',
            }
        },
        {
            $lookup: {
                from: 'requests',
                localField: '_id',
                foreignField: 'productId',
                as: 'requests'
            }
        },
        {
            $match: {
                'requests.isAccepted': true
            }
        },
        {
            $lookup: {
                from: 'hubs',
                localField: 'fromHubId',
                foreignField: '_id',
                as: 'fromHubId'
            }
        },
        { $unwind: '$fromHubId' },
        {
            $lookup: {
                from: 'hubs',
                localField: 'toHubId',
                foreignField: '_id',
                as: 'toHubId'
            }
        },
        { $unwind: '$toHubId' },
        {
            $lookup: {
                from: 'users',
                localField: 'shipperId',
                foreignField: '_id',
                as: 'shipperId'
            }
        },
        { $unwind: '$shipperId' },
        {
            $lookup: {
                from: 'users',
                localField: 'receiverId',
                foreignField: '_id',
                as: 'receiverId'
            }
        },
        { $unwind: '$receiverId' },
    ]);

    const productsWithCustomAmount = pendingProducts.map((product) => {

        return {
            productName: product.name,
            productId: product._id,
            uniqueCode: product.uniqueCode,
            weight: `${product.weight}kg`,
            fromHubName: product.fromHubId.name,
            toHubName: product.toHubId.name,
            shipperId: product.shipperId._id,
            receiverId: product.receiverId._id,
            amount: product.transporterAmount,
        };
    });

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'Pending products retrieved successfully',
        data: productsWithCustomAmount,
    });
});

// Scan barcode and take product (User acting as transporter)
export const scanBarcodeAndTakeProduct = catchAsync(async (req, res) => {
    const { productId, scannedCode } = req.body;

    if (!productId || !scannedCode) {
        throw new AppError(400, 'Product ID and scanned code are required');
    }

    const product = await Product.findOne({ _id: productId, status: 'Pending' }).select('uniqueCode name weight toHubId fromHubId measurement transporterAmount');
    if (!product) {
        throw new AppError(404, 'Product not found or already taken');
    }

    if (product.uniqueCode !== parseInt(scannedCode)) {
        throw new AppError(400, 'Invalid barcode');
    }

    product.status = 'Assigned';
    product.transporterId = req.user._id;
    await product.save();

    // Notify shipper
    await createNotification(
        product.shipperId,
        `Your product ${product.uniqueCode} has been picked up by a transporter`,
        'shipment',
        product._id,
        'Product'
    );

    // Notify receiver
    await createNotification(
        product.receiverId,
        `Your product ${product.uniqueCode} is on the way`,
        'shipment',
        product._id,
        'Product'
    );

    const request = new Request({
        productId,
        userId: req.user._id,
        type: 'pickup',
    });
    await request.save();

    console.log(request);
    console.log(product);

    await Transporter.create({
        productId: product._id,
        transporterId: req.user._id,
        fromHubId: product.fromHubId,
        toHubId: product.toHubId,
        status: 'pending'
    })

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'Barcode scanned successfully. Product is now in transit.',
        data: { product, request },
    });
});

// Submit product to destination hub (User acting as transporter)
export const submitProduct = catchAsync(async (req, res) => {
    const { productId } = req.body;

    if (!productId) {
        throw new AppError(400, 'Product ID is required');
    }

    const product = await Product.findOne({ _id: productId, transporterId: req.user._id }).select('uniqueCode name weight measurement transporterAmount');
    if (!product) {
        throw new AppError(404, 'Product not found or not assigned to you');
    }

    const request = new Request({
        productId,
        userId: req.user._id,
        type: 'delivery',
    });
    await request.save();

    // Notify receiver
    await createNotification(
        product.receiverId,
        `Your product ${product.uniqueCode} has reached the destination hub`,
        'shipment',
        product._id,
        'Product'
    );

    await Transporter.create({
        productId: product._id,
        transporterId: req.user._id,
        fromHub: product.fromHubId,
        toHub: product.toHubId,
        status: 'pending'
    })

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'Submit request sent to hub manager',
        data: { product, request },
    });
});

// Get products to receive (User acting as receiver)
export const getProductsToReceive = catchAsync(async (req, res) => {
    const reachedProducts = await Product.find({
        receiverId: req.user._id,
        status: 'Reached',
    })
        .populate({ path: 'fromHubId', select: 'name' })
        .populate({ path: 'toHubId', select: 'name' })
        .populate({ path: 'shipperId', select: 'name' })
        .populate({ path: 'receiverId', select: 'name' });

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'Products to receive retrieved successfully',
        data: reachedProducts,
    });
});

// Combined receive and scan controller
export const receiveAndScanProduct = catchAsync(async (req, res) => {
    const { productId, scannedCode } = req.body;

    // Validate input
    if (!productId || !scannedCode) {
        throw new AppError(400, 'Product ID and scanned code are required');
    }

    // Find the product
    const product = await Product.findOne({
        _id: productId,
        receiverId: req.user._id,
        status: 'Reached'
    });

    if (!product) {
        throw new AppError(404, 'Product not found or not ready to receive');
    }

    // Verify barcode
    if (product.uniqueCode !== parseInt(scannedCode)) {
        throw new AppError(400, 'Invalid barcode');
    }

    // Create a receive-scan request for hub manager approval
    const request = new Request({
        productId,
        userId: req.user._id,
        type: 'receive',
        status: 'Pending Approval'
    });
    await request.save();

    // Notify shipper
    await createNotification(
        product.shipperId,
        `Your product ${product.uniqueCode} is being delivered to the receiver`,
        'shipment',
        product._id,
        'Product'
    );

    // Update product status to indicate waiting for approval
    product.status = 'Pending Receipt Approval';
    await product.save();

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'Product scanned successfully. Waiting for hub manager approval.',
        data: { product, request }
    });
});

// Get user history (Shipper, Transporter, Receiver history)
export const getHistory = catchAsync(async (req, res) => {
    const shipped = await Product.find({ shipperId: req.user._id }).populate('fromHubId toHubId', 'name')
    const transported = await Product.find({ transporterId: req.user._id }).populate('fromHubId toHubId', 'name');
    const received = await Product.find({ receiverId: req.user._id }).populate('fromHubId toHubId', 'name');

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'User history retrieved successfully',
        data: { shipped, transported, received },
    });
});

// Get user profile
export const getProfile = catchAsync(async (req, res) => {
    const user = await User.findById(req.user._id).select('-password')
    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'User profile retrieved successfully',
        data: user,
    });
});

// Edit Profile
export const editProfile = catchAsync(async (req, res) => {
    const { name } = req.body;

    const updateData = {};

    if (name) updateData.name = name;

    if (req.file) {
        try {
            const image = await uploadOnCloudinary(req.file.buffer, 'users');
            updateData.image = image.secure_url;
        } catch (error) {
            throw new AppError(500, 'Error uploading image');
        }
    }

    const user = await User.findByIdAndUpdate(
        req.user._id,
        updateData,
        { new: true, runValidators: true }
    ).select('name username image');

    if (!user) {
        throw new AppError(404, 'User not found');
    }

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'Profile updated successfully',
        data: user,
    });
});

// Change Password
export const changePassword = catchAsync(async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
        throw new AppError(400, 'All fields are required');
    }

    if (newPassword !== confirmPassword) {
        throw new AppError(400, 'New password and confirmation do not match');
    }

    const user = await User.findById(req.user._id);
    if (!(await user.isPasswordValid(currentPassword))) {
        throw new AppError(401, 'Current password is incorrect');
    }

    user.password = newPassword;
    await user.save();

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'Password changed successfully',
        data: null,
    });
});

// Get user ongoing shipments
export const getOngoingShipments = catchAsync(async (req, res) => {
    const shipments = await Product.find({
        shipperId: req.user._id, status: { $in: ['Pending', 'Assigned', 'On the way', 'Reached', 'Pending Receipt Approval', 'Received', 'Canceled'] }
    })
        .populate('fromHubId toHubId').lean()

    const updatedShipments = shipments.map(shipment => {
        let fromHub = shipment.fromHubId
        let toHub = shipment.toHubId;
        delete shipment.fromHubId;
        delete shipment.toHubId;
        return {
            ...shipment,
            fromHub: fromHub,
            toHub: toHub,
        };
    });

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'Ongoing shipments retrieved successfully',
        data: updatedShipments,
    });
})

// Usecase: hubs to choose from
export const availableHubs = catchAsync(async (req, res) => {
    const hubs = await Hub.find();
    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: `${hubs.length} hubs`,
        data: hubs,
    });
})

// Get on the way products (User acting as transporter)
export const getOnTheWayProducts = catchAsync(async (req, res) => {
    const products = await Product.find({
        transporterId: req.user._id,
        status: { $in: ['On the way', 'Assigned'] }
    })
        .populate('fromHubId toHubId shipperId receiverId', 'name')
        .select('name uniqueCode weight measurement transporterAmount fromHubId toHubId shipperId receiverId')
        .lean();

    const updatedProducts = products.map(product => {
        let fromHub = product.fromHubId
        let toHub = product.toHubId;
        delete product.fromHubId;
        delete product.toHubId;
        return {
            ...product,
            fromHub: fromHub,
            toHub: toHub,
        };
    });

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'On the way products retrieved successfully',
        data: updatedProducts,
    });
})