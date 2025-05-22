import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io'
import dbConnection from './config/dbConnection.js';
import globalErrorHandler from './src/middlewares/globalError.middlewares.js';
import notFound from './src/middlewares/notFound.middlewares.js';
import routes from './config/route.config.js';
import { Product } from './src/models/product.models.js';
const PORT = process.env.PORT || 5001;

const app = express();
const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: process.env.ALLOWORIGIN,
        methods: ["GET", "POST"],
        credentials: true,
    },
});

dotenv.config({ path: './.env' });

app.use(express.json());   
app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true,
}));

// WebSocket connection
io.on('connection', (socket) => {
    console.log('A client connected:', socket.id);

    // Join user-specific room for notifications
    socket.on('joinUserRoom', (userId) => {
        if (userId) {
            socket.join(`user_${userId}`);
            console.log(`Client ${socket.id} joined user room: ${userId}`);
        }
    });

    // Join specific product room for location updates
    socket.on('joinProductRoom', async (productId) => {
        try {
            // Verify the user has access to this product
            const product = await Product.findById(productId);
            if (!product) {
                socket.emit('error', 'Product not found');
                return;
            }

            socket.join(productId);
            console.log(`Client ${socket.id} joined room: ${productId}`);

            // Send current location immediately upon joining
            if (product.liveCoordinates) {
                socket.emit('locationUpdated', {
                    productId,
                    coordinates: product.liveCoordinates,
                    status: product.status
                });
            }
        } catch (error) {
            socket.emit('error', error.message);
        }
    });

    // Handle location updates from transporters
    socket.on('updateLocation', async ({ productId, lat, lng }) => {
        try {
            // Validate coordinates
            if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
                throw new Error('Invalid coordinates');
            }

            // Update in database
            const product = await Product.findByIdAndUpdate(
                productId,
                {
                    liveCoordinates: {
                        lat,
                        lng,
                        timestamp: Date.now(),
                        transporterId: req.user._id,
                    },
                    status: 'On the way'
                },
                { new: true }
            ).populate('transporterId');

            if (!product) {
                throw new Error('Product not found');
            }

            // Broadcast to all clients in this product's room
            io.to(productId).emit('locationUpdated', {
                productId,
                coordinates: { lat, lng },
                timestamp: Date.now(),
                transporter: {
                    _id: product.transporterId._id,
                    name: product.transporterId.name
                },
                status: product.status
            });

        } catch (error) {
            socket.emit('error', error.message);
        }
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// root route
app.get("/", (req, res) => {
    return res.status(200).json({
        status: true,
        message: "Welcome to the server"
    });
});

// routes
app.use("/api/v1", routes);

// error handling middlewares
app.use(globalErrorHandler);
app.use(notFound);

server.listen(PORT, async () => {
    await dbConnection();
    console.log(`Server is running on port http://localhost:${PORT}`);
});


export { io }





