// server.js - Main Node.js Express Server
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const multer = require('multer');
const app = express();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static('uploads'));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/cricket_booking', {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

// User Schema
const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    phone: { type: String, required: true },
    isAdmin: { type: Boolean, default: false }
}, { timestamps: true });

// Ground Schema
const groundSchema = new mongoose.Schema({
    name: { type: String, required: true },
    address: { type: String, required: true },
    images: [String],
    location: {
        lat: Number,
        lng: Number
    },
    openTime: { type: String, required: true },
    closeTime: { type: String, required: true },
    pricePerHour: { type: Number, required: true },
    amenities: [String],
    qrCodeImage: String,
    upiId: String,
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

// Booking Schema
const bookingSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    groundId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ground', required: true },
    date: { type: Date, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    totalAmount: { type: Number, required: true },
    paymentStatus: { type: String, enum: ['pending', 'paid', 'verified'], default: 'pending' },
    bookingStatus: { type: String, enum: ['pending', 'confirmed', 'cancelled'], default: 'pending' },
    paymentScreenshot: String,
    transactionId: String
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const Ground = mongoose.model('Ground', groundSchema);
const Booking = mongoose.model('Booking', bookingSchema);

// Multer configuration for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/')
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname)
    }
});
const upload = multer({ storage: storage });

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'cricket_booking_secret_key';

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
};

// Routes

// User Registration
app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password, phone } = req.body;
        
        // Check if user exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ error: 'User already exists' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Create user
        const user = new User({
            name,
            email,
            password: hashedPassword,
            phone
        });
        
        await user.save();
        
        // Generate JWT token
        const token = jwt.sign({ userId: user._id, isAdmin: user.isAdmin }, JWT_SECRET);
        
        res.status(201).json({
            message: 'User registered successfully',
            token,
            user: { id: user._id, name: user.name, email: user.email, isAdmin: user.isAdmin }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// User Login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // Find user
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }
        
        // Check password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }
        
        // Generate JWT token
        const token = jwt.sign({ userId: user._id, isAdmin: user.isAdmin }, JWT_SECRET);
        
        res.json({
            message: 'Login successful',
            token,
            user: { id: user._id, name: user.name, email: user.email, isAdmin: user.isAdmin }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all grounds
app.get('/api/grounds', async (req, res) => {
    try {
        const grounds = await Ground.find({ isActive: true });
        res.json(grounds);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get single ground
app.get('/api/grounds/:id', async (req, res) => {
    try {
        const ground = await Ground.findById(req.params.id);
        if (!ground) {
            return res.status(404).json({ error: 'Ground not found' });
        }
        res.json(ground);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add ground (Admin only)
app.post('/api/admin/grounds', authenticateToken, upload.array('images', 5), async (req, res) => {
    try {
        if (!req.user.isAdmin) {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const { name, address, lat, lng, openTime, closeTime, pricePerHour, amenities, upiId } = req.body;
        
        const images = req.files ? req.files.map(file => file.filename) : [];
        
        const ground = new Ground({
            name,
            address,
            images,
            location: { lat: parseFloat(lat), lng: parseFloat(lng) },
            openTime,
            closeTime,
            pricePerHour: parseFloat(pricePerHour),
            amenities: amenities ? amenities.split(',') : [],
            upiId
        });
        
        await ground.save();
        res.status(201).json({ message: 'Ground added successfully', ground });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Check slot availability
app.get('/api/grounds/:id/availability/:date', async (req, res) => {
    try {
        const { id, date } = req.params;
        const ground = await Ground.findById(id);
        
        if (!ground) {
            return res.status(404).json({ error: 'Ground not found' });
        }

        // Get existing bookings for the date
        const bookings = await Booking.find({
            groundId: id,
            date: new Date(date),
            bookingStatus: { $ne: 'cancelled' }
        });

        // Generate available slots (simplified - 1-hour slots)
        const slots = [];
        const openHour = parseInt(ground.openTime.split(':')[0]);
        const closeHour = parseInt(ground.closeTime.split(':')[0]);
        
        for (let hour = openHour; hour < closeHour; hour++) {
            const startTime = `${hour.toString().padStart(2, '0')}:00`;
            const endTime = `${(hour + 1).toString().padStart(2, '0')}:00`;
            
            const isBooked = bookings.some(booking => 
                booking.startTime === startTime
            );
            
            slots.push({
                startTime,
                endTime,
                available: !isBooked,
                price: ground.pricePerHour
            });
        }
        
        res.json({ slots });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create booking
app.post('/api/bookings', authenticateToken, async (req, res) => {
    try {
        const { groundId, date, startTime, endTime } = req.body;
        
        // Check if slot is available
        const existingBooking = await Booking.findOne({
            groundId,
            date: new Date(date),
            startTime,
            bookingStatus: { $ne: 'cancelled' }
        });
        
        if (existingBooking) {
            return res.status(400).json({ error: 'Slot not available' });
        }
        
        // Get ground details
        const ground = await Ground.findById(groundId);
        if (!ground) {
            return res.status(404).json({ error: 'Ground not found' });
        }
        
        // Calculate total amount (simplified - 1 hour booking)
        const totalAmount = ground.pricePerHour;
        
        const booking = new Booking({
            userId: req.user.userId,
            groundId,
            date: new Date(date),
            startTime,
            endTime,
            totalAmount
        });
        
        await booking.save();
        
        // Generate UPI payment link
        const upiLink = `upi://pay?pa=${ground.upiId}&pn=${ground.name}&am=${totalAmount}&tn=Cricket Ground Booking&cu=INR`;
        
        res.status(201).json({
            message: 'Booking created successfully',
            booking,
            upiLink,
            qrCode: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(upiLink)}`
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get user bookings
app.get('/api/bookings', authenticateToken, async (req, res) => {
    try {
        const bookings = await Booking.find({ userId: req.user.userId })
            .populate('groundId', 'name address')
            .sort({ createdAt: -1 });
        res.json(bookings);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Admin: Get all bookings
app.get('/api/admin/bookings', authenticateToken, async (req, res) => {
    try {
        if (!req.user.isAdmin) {
            return res.status(403).json({ error: 'Admin access required' });
        }
        
        const bookings = await Booking.find()
            .populate('userId', 'name email phone')
            .populate('groundId', 'name address')
            .sort({ createdAt: -1 });
        res.json(bookings);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Admin: Verify payment and confirm booking
app.patch('/api/admin/bookings/:id/verify', authenticateToken, async (req, res) => {
    try {
        if (!req.user.isAdmin) {
            return res.status(403).json({ error: 'Admin access required' });
        }
        
        const booking = await Booking.findById(req.params.id);
        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }
        
        booking.paymentStatus = 'verified';
        booking.bookingStatus = 'confirmed';
        await booking.save();
        
        res.json({ message: 'Booking verified and confirmed', booking });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Serve HTML pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/booking/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'booking.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// ============================================
// FRONTEND FILES
// ============================================

/* 
Create the following directory structure:
/public
  - index.html
  - login.html
  - register.html
  - dashboard.html
  - admin.html
  - booking.html
  - styles.css
  - script.js
/uploads (create empty folder)

package.json:
{
  "name": "cricket-booking-app",
  "version": "1.0.0",
  "description": "Box Cricket Booking Web Application",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "mongoose": "^7.0.3",
    "bcryptjs": "^2.4.3",
    "jsonwebtoken": "^9.0.0",
    "multer": "^1.4.5-lts.1"
  },
  "devDependencies": {
    "nodemon": "^2.0.22"
  }
}
*/