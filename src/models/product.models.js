import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
    uniqueCode:
    {
        type: Number,
        required: true,
        unique: true
    },
    name:
    {
        type: String,
        required: true
    },
    description:
    {
        type: String,
        required: true
    },
    weight:
    {
        type: Number,
        required: true
    },
    measurement:
    {
        type: Number,
        required: true
    },
    fromHubId:
    {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Hub', required: true
    },
    toHubId:
    {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Hub', required: true
    },
    shipperId:
    {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User', required: true
    },
    receiverId:
    {
        type: mongoose.Schema.Types.ObjectId,

        ref: 'User', required: true
    },
    transporterId:
    {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User', required: false
    },
    status: {
        type: String,
        enum: ['Pending', 'Assigned', 'On the way', 'Reached', 'Pending Receipt Approval', 'Received', 'Canceled'],
        default: 'Pending',
    },
    amount:
    {
        type: Number,
        required: true
    },
    transporterAmount:
    {
        type: Number,
        required: true
    },
    createdAt:
    {
        type: Date,
        default: Date.now
    },
    locations: [
        {
            hubId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Hub'
            },
            userId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'User'
            },
            action: {
                type: String,
                enum: ['received', 'processed', 'dispatched', 'exception'],
                required: true
            },
            notes: String,
            timestamp: {
                type: Date,
                default: Date.now
            },
            coordinates: {
                lat: Number,
                lng: Number
            }
        },
    ],
    liveCoordinates: {
        lat: {
            type: Number,
            min: -90,
            max: 90,
            required: false
        },
        lng: {
            type: Number,
            min: -180,
            max: 180,
            required: false
        },
        timestamp: {
            type: Date,
        },
        transporterId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
    },
});

export const Product = mongoose.model('Product', productSchema);
