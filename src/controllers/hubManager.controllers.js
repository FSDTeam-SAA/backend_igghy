import catchAsync from '../utilty/catchAsync.js';
import AppError from '../errors/AppError.js';
import { createNotification, sendResponse } from '../utilty/helper.utilty.js';
import { Request } from '../models/request.models.js';
import { User } from '../models/user.models.js';
import { Product } from '../models/product.models.js';
import { Transporter } from '../models/transporter.models.js';

// Get hub manager profile (name and assigned hub)
export const getProfile = catchAsync(async (req, res) => {
    const hubManager = await User.findById(req.user._id).populate('hubId');
    if (!hubManager) {
        throw new AppError(404, 'Hub manager not found');
    }

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'Profile retrieved successfully',
        data: {
            name: hubManager.name,
            hubName: hubManager.hubId.name,
        },
    });
});

// Approve or reject a request
export const manageRequest = catchAsync(async (req, res) => {
    const { requestId, action } = req.body;

    if (!requestId || !action) {
        throw new AppError(400, 'Request ID and action are required');
    }

    const request = await Request.findById(requestId).populate({
        path: 'productId',
        populate: { path: 'fromHubId toHubId' },
    });

    if (!request || request.status !== 'Pending Approval') {
        throw new AppError(404, 'Request not found or already processed');
    }

    const product = request.productId;

    if (!product || !product.fromHubId || !product.toHubId) {
        throw new AppError(500, 'Product or hub information is missing');
    }

    const hubIdToCheck =
        request.type === 'pickup' || request.type === 'print' || request.type === 'delivery' || request.type === 'receive'
            ? product.fromHubId._id
            : product.toHubId._id;

    if (!req.user?.hubId) {
        throw new AppError(401, 'Hub ID not associated with authenticated user');
    }

    if (req.user.hubId.toString() !== hubIdToCheck.toString()) {
        throw new AppError(403, 'You are not authorized to manage this request');
    }

    if (action === 'approve') {
        switch (request.type) {
            case 'print':
                request.status = 'Approved';
                break;

            case 'pickup':
                product.transporterId = request.userId;
                product.status = 'Assigned';
                request.status = 'Approved';
                await Transporter.findOneAndUpdate({
                    productId: product._id
                },
                    {
                        status: 'on the way'
                    }
                )
                break;

            case 'scan':
                product.status = 'On the way';
                product.locations.push({
                    hubId: product.fromHubId,
                    action: 'scanned',
                    timestamp: new Date(),
                });
                request.status = 'Approved';

                await Transporter.findOneAndUpdate({
                    productId: product._id
                },
                    {
                        status: 'on the way'
                    }
                )

                const scanTransporter = await User.findById(request.userId);
                if (scanTransporter) {
                    scanTransporter.totalProductsTransported += 1;
                    scanTransporter.totalAmountTransported += product.amount;
                    await scanTransporter.save();
                }
                break;

            case 'delivery':
                request.status = 'Approved';
                product.locations.push({
                    hubId: product.toHubId,
                    action: 'dispatched',
                    timestamp: new Date(),
                });
                product.status = 'Reached';

                await Transporter.findOneAndUpdate({
                    productId: product._id
                },
                    {
                        status: 'completed'
                    }
                )

                const deliveryTransporter = await User.findById(request.userId);
                if (deliveryTransporter) {
                    deliveryTransporter.totalProductsTransported += 1;
                    deliveryTransporter.totalAmountTransported += product.amount;
                    await deliveryTransporter.save();
                }
                break;

            case 'receive':
                product.status = 'Received';
                product.locations.push({
                    hubId: product.toHubId,
                    action: 'received',
                    timestamp: new Date(),
                });
                request.status = 'Approved';

                const receiver = await User.findById(request.userId);
                if (receiver) {
                    receiver.totalProductsReceived += 1;
                    receiver.totalAmountReceived += product.amount;
                    await receiver.save();
                }
                break;

            default:
                throw new AppError(400, 'Invalid request type');
        }

        request.isAccepted = true;
        // Notify requester
        await createNotification(
            request.userId,
            `Your ${request.type} request for product ${product.uniqueCode} has been approved`,
            'request',
            product._id,
            'Product'
        );
    } else if (action === 'reject') {
        request.status = 'Rejected';
        request.isAccepted = false;

        if (request.type === 'print') {
            product.status = 'Canceled';
            await product.save();
        }

        // Notify requester
        await createNotification(
            request.userId,
            `Your ${request.type} request for product ${product.uniqueCode} has been rejected`,
            'request',
            product._id,
            'Product'
        );
    } else {
        throw new AppError(400, 'Invalid action');
    }

    // Save changes
    await product.save();
    await request.save();

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: `Request ${action}ed successfully`,
        data: request,
    });
});

// Helper function to filter and paginate requests
const fetchRequests = async (req, types) => {
    const { page = 1, limit = 10, search = '', fromDate, toDate } = req.query;

    const pageNum = Math.max(1, parseInt(page) || 1); // Ensure page is at least 1
    const limitNum = Math.max(1, parseInt(limit) || 10); // Ensure limit is at least 1
    const skip = (pageNum - 1) * limitNum;

    let query = {
        status: 'Pending Approval',
        type: { $in: types },
    };

    // Date range filter
    if (fromDate || toDate) {
        query.createdAt = {};
        if (fromDate) query.createdAt.$gte = new Date(fromDate);
        if (toDate) query.createdAt.$lte = new Date(toDate);
    }

    const requests = await Request.find(query)
        .populate({
            path: 'productId',
            populate: [
                { path: 'fromHubId' },
                { path: 'toHubId' },
                { path: 'shipperId', select: 'name email phone' },
                { path: 'receiverId', select: 'name email phone' },
            ],
        })
        .populate('userId');

    // Filter requests for the hub manager's hub
    let filteredRequests = requests.filter((request) => {
        const product = request.productId;
        console.log(request);
        const hubIdToCheck = types.includes('pickup') || types.includes('print') || types.includes('delivery') || types.includes('receive') ? product.fromHubId._id : product.toHubId._id;
        return hubIdToCheck.toString() === req.user?.hubId?.toString();

    });


    // Search filter (product code, shipper name, receiver name)
    if (search) {
        filteredRequests = filteredRequests.filter((request) => {
            const product = request.productId;
            return (
                product.uniqueCode.toString().includes(search) ||
                product.shipperId.name.toLowerCase().includes(search.toLowerCase()) ||
                product.receiverId.name.toLowerCase().includes(search.toLowerCase())
            );
        });
    }

    const total = filteredRequests.length;
    const paginatedRequests = filteredRequests.slice(skip, skip + limitNum);

    const formattedRequests = paginatedRequests.map((request) => ({
        requestId: request._id,
        productCode: request.productId.uniqueCode,
        productName: request.productId.name,
        weight: request.productId.weight,
        measurement: request.productId.measurement,
        shipper: {
            name: request.productId.shipperId.name,
            email: request.productId.shipperId.email,
            phone: request.productId.shipperId.phone,
        },
        receiver: {
            name: request.productId.receiverId.name,
            email: request.productId.receiverId.email,
            phone: request.productId.receiverId.phone,
        },
        fromHub: request.productId.fromHubId.name,
        toHub: request.productId.toHubId.name,
        price: request.productId.amount,
        type: request.type,
        createdAt: request.createdAt,
    }));

    return {
        requests: formattedRequests,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
    };
};

// Controller for Shipper Requests (type: 'print')
export const getShipperRequests = catchAsync(async (req, res) => {
    const { requests, total, page, limit, totalPages } = await fetchRequests(req, ['print']);

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'Shipper requests retrieved successfully',
        data: {
            requests,
            pagination: { total, page, limit, totalPages }
        },
    });
});

// Controller for Transport Requests (type: 'pickup', 'scan')
export const getTransportRequests = catchAsync(async (req, res) => {
    const { requests, total, page, limit, totalPages } = await fetchRequests(req, ['pickup', 'scan']);

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'Transport requests retrieved successfully',
        data: {
            requests,
            pagination: { total, page, limit, totalPages }
        },
    });
});

// Controller for Submit Product Requests (type: 'delivery')
export const getSubmitProductRequests = catchAsync(async (req, res) => {
    const { requests, total, page, limit, totalPages } = await fetchRequests(req, ['delivery']);

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'Submit product requests retrieved successfully',
        data: {
            requests,
            pagination: { total, page, limit, totalPages }
        },
    });
});

// Controller for Receiver Requests (type: 'receive', 'receive-scan')
export const getReceiverRequests = catchAsync(async (req, res) => {
    const { requests, total, page, limit, totalPages } = await fetchRequests(req, ['receive', 'receive-scan']);

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'Receiver requests retrieved successfully',
        data: {
            requests,
            pagination: { total, page, limit, totalPages }
        },
    });
});