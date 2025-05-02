const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb'); // Added ObjectId
const { body, validationResult } = require('express-validator');
const dotenv = require('dotenv');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

// Load environment variables from .env file.
// Ensure your sensitive data (DB URI, Cloudinary creds) are in a .env file
// in your backend directory (or project root if dotenv config path is adjusted).
dotenv.config();

const app = express();

// ============================
// Middleware
// ============================
// Enable CORS - adjust origin restrictions in production for security
app.use(cors());

// Parse incoming JSON requests
app.use(express.json());

// Parse URL-encoded data - necessary for form submissions not handled by Multer directly
app.use(express.urlencoded({ extended: true }));

// ============================
// Serve Frontend Static Files
// ============================
// In this simplified structure, the backend Express server serves the frontend.
const frontendPath = path.join(__dirname, '../frontend/public');
app.use(express.static(frontendPath));

// Serve index.html for the root path
app.get('/', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
});

// ============================
// MongoDB Config (Using environment variables)
// ============================
// Ensure MONGODB_URI and MONGODB_DB_NAME are set in your .env file
const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || "affinitybadgeDB"; // Use DB name from .env or default

if (!uri) {
    console.error("❌ MONGODB_URI is not set in the .env file!");
    process.exit(1); // Exit if DB URI is not configured
}

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

let db; // Variable to hold the database connection

async function connectDB() {
    try {
        await client.connect();
        db = client.db(dbName);
        console.log(`✅ Connected to MongoDB! Database: ${dbName}`);

        // Optional: Ping the server to confirm connection and authentication
        await client.db("admin").command({ ping: 1 });
        console.log("✅ MongoDB Ping successful.");

    } catch (err) {
        console.error("❌ MongoDB Connection Error:", err);
        // Log the error and potentially exit or retry connection
        // process.exit(1); // Uncomment to exit if DB connection fails
    }
}

// Connect to the database when the server starts
connectDB();

// Close the MongoDB connection when the application is closing
process.on('SIGINT', async () => {
    console.log("\nClosing MongoDB connection...");
    if (client) {
        await client.close();
        console.log("MongoDB connection closed.");
    }
    process.exit(0);
});
process.on('SIGTERM', async () => {
    console.log("\nClosing MongoDB connection...");
     if (client) {
        await client.close();
        console.log("MongoDB connection closed.");
    }
    process.exit(0);
});


// ============================
// Cloudinary Config (Using environment variables)
// ============================
// Ensure CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET are in your .env file
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Add a check to ensure credentials are loaded
if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
     console.error("❌ Cloudinary credentials are not fully set in the .env file!");
     // Decide how to handle this - log and continue, or exit.
     // console.warn("Cloudinary uploads will not work without credentials.");
     // process.exit(1); // Uncomment to exit if Cloudinary credentials missing
}


// ============================
// Multer Config (Temp storage for file uploads)
// ============================
// Define a temporary directory to store uploaded files before processing
const uploadDir = path.join(__dirname, 'uploads');

// Ensure the uploads directory exists
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir);
    console.log(`✅ Created uploads directory: ${uploadDir}`);
}

const upload = multer({
    dest: uploadDir, // Temporary directory to store uploaded files
    limits: { fileSize: 1024 * 1024 * 10 }, // Example limit: 10MB per file (adjust as needed for IDs/photos)
    fileFilter: (req, file, cb) => {
        // Basic file type filter based on frontend requirements (images, pdf for ID)
        const allowedMimes = [
            'image/jpeg',
            'image/png',
            'application/pdf' // For Government ID
        ];

        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true); // Accept the file
        } else {
            // Reject the file with a specific error message
            cb(new Error('Invalid file type. Only JPG, PNG, and PDF are allowed.'), false);
        }
    }
});


// ============================
// API Endpoints
// ============================

// --- POST /submit-form (Handles application form submissions with multiple files) ---
// Expanded to match all frontend form fields and handle multiple file uploads
app.post(
    '/submit-form',
    // Multer middleware to handle specific named file uploads from the frontend form
    upload.fields([
        { name: 'govId', maxCount: 1 },          // Expecting one file named 'govId'
        { name: 'passportPhoto', maxCount: 1 },  // Expecting one file named 'passportPhoto'
        { name: 'biometricPhoto', maxCount: 1 }, // Expecting one file named 'biometricPhoto' (from upload or capture)
        { name: 'digitalSignature', maxCount: 1 } // Expecting one file named 'digitalSignature' (the signature image)
    ]),
    // Validation Middleware (Expanded to validate ALL required fields from the frontend)
    [
        body('fullName').trim().notEmpty().withMessage('Full Name is required'),
        body('dob').isDate().withMessage('Valid Date of Birth is required'),
        body('gender').trim().notEmpty().withMessage('Gender is required'),
        body('nationality').trim().notEmpty().withMessage('Nationality is required'),
        body('email').isEmail().withMessage('A valid email is required').normalizeEmail(),
        body('phone').trim().notEmpty().withMessage('Phone Number is required'), // Add more specific phone format validation if needed
        body('address').trim().notEmpty().withMessage('Residential Address is required'),
        body('membershipTier').trim().notEmpty().withMessage('Membership Tier selection is required'),
        body('consent').toBoolean().equals(true).withMessage('Consent and Agreement is required'),
        // Optional fields - no validation needed for notEmpty, but could validate format if necessary
        body('socialMedia').optional().trim(),
        body('preferredBadgeName').optional().trim(),
    ],
    async (req, res, next) => { // Added next for error handling middleware
        // Check for validation errors from express-validator
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            // Clean up uploaded files if validation fails
            if (req.files) {
                Object.values(req.files).forEach(fileArray => {
                    fileArray.forEach(file => {
                        if (fs.existsSync(file.path)) {
                             fs.unlinkSync(file.path);
                             console.log(`Cleaned up file: ${file.path} after validation error.`);
                        }
                    });
                });
            }
            return res.status(400).json({ errors: errors.array() });
        }

        // Check if all required files were uploaded
        const govIdFile = req.files && req.files['govId'] ? req.files['govId'][0] : null;
        const passportPhotoFile = req.files && req.files['passportPhoto'] ? req.files['passportPhoto'][0] : null;
        const biometricPhotoFile = req.files && req.files['biometricPhoto'] ? req.files['biometricPhoto'][0] : null;
        const digitalSignatureFile = req.files && req.files['digitalSignature'] ? req.files['digitalSignature'][0] : null;

        if (!govIdFile || !passportPhotoFile || !biometricPhotoFile || !digitalSignatureFile) {
             // Clean up uploaded files if a required one is missing
             if (req.files) {
                 Object.values(req.files).forEach(fileArray => {
                     fileArray.forEach(file => {
                         if (fs.existsSync(file.path)) {
                              fs.unlinkSync(file.path);
                               console.log(`Cleaned up file: ${file.path} after missing required file.`);
                         }
                     });
                 });
             }
             // Identify which file(s) are missing
             const missingFiles = [];
             if (!govIdFile) missingFiles.push('Government Issued ID');
             if (!passportPhotoFile) missingFiles.push('Passport Photograph');
             if (!biometricPhotoFile) missingFiles.push('Biometric Photo');
             if (!digitalSignatureFile) missingFiles.push('Digital Signature');

             return res.status(400).json({ error: `Missing required file(s): ${missingFiles.join(', ')}` });
        }

        try {
            // Extract all form fields from the request body
            const {
                fullName,
                dob,
                gender,
                nationality,
                email,
                phone,
                address,
                socialMedia, // Optional
                preferredBadgeName, // Optional
                membershipTier,
                consent // Should be true due to validation
            } = req.body;

            // --- Upload files to Cloudinary ---
            // Use appropriate folders for organization
            const uploadOptions = { folder: 'affinity-badge-portal/applications' }; // Base folder

            const govIdResult = await cloudinary.uploader.upload(govIdFile.path, { ...uploadOptions, folder: `${uploadOptions.folder}/ids` });
            const passportPhotoResult = await cloudinary.uploader.upload(passportPhotoFile.path, { ...uploadOptions, folder: `${uploadOptions.folder}/passport-photos` });
            const biometricPhotoResult = await cloudinary.uploader.upload(biometricPhotoFile.path, { ...uploadOptions, folder: `${uploadOptions.folder}/biometrics` });
            const digitalSignatureResult = await cloudinary.uploader.upload(digitalSignatureFile.path, { ...uploadOptions, folder: `${uploadOptions.folder}/signatures` });

            console.log("Files uploaded to Cloudinary."); // Debugging


            // --- Clean up temporary files after uploading to Cloudinary ---
            // Use a function for cleaner cleanup
            const cleanupFiles = (files) => {
                 files.forEach(file => {
                     if (file && fs.existsSync(file.path)) {
                         fs.unlink(file.path, (err) => { // Use async unlink
                             if (err) console.error(`Error deleting temp file ${file.path}:`, err);
                             else console.log(`Cleaned up temp file: ${file.path}`);
                         });
                     }
                 });
            };
            cleanupFiles([govIdFile, passportPhotoFile, biometricPhotoFile, digitalSignatureFile]);


            // --- Prepare submission data for MongoDB ---
            // Include all relevant fields and file URLs
            const submission = {
                fullName,
                dob,
                gender,
                nationality,
                email,
                phone,
                address,
                socialMedia: socialMedia || null, // Handle optional
                preferredBadgeName: preferredBadgeName || null, // Handle optional
                membershipTier, // Store the selected tier
                govIdUrl: govIdResult.secure_url,
                passportPhotoUrl: passportPhotoResult.secure_url,
                biometricPhotoUrl: biometricPhotoResult.secure_url,
                digitalSignatureUrl: digitalSignatureResult.secure_url,
                applicationStatus: 'Submitted', // Initial status of the application
                createdAt: new Date(),
                updatedAt: new Date(),
                // Link to a user ID if implementing user authentication
                // userId: req.user ? req.user.id : null, // Example if user is authenticated
            };

            // --- Save submission to MongoDB ---
            if (!db) {
                 throw new Error("Database not connected. Cannot save application submission.");
            }
            const applicationsCollection = db.collection("applications"); // Use 'applications' collection
            const result = await applicationsCollection.insertOne(submission);

            console.log(`Application saved to MongoDB with ID: ${result.insertedId}`); // Debugging

            // --- Respond to client ---
            // Send back a success message and potentially the application status and ID
            res.status(201).json({
                message: "Application submitted successfully!",
                applicationId: result.insertedId, // Return the MongoDB _id
                status: submission.applicationStatus // Return the initial status
            });

        } catch (error) {
            console.error('Form submission error:', error);

             // --- Clean up uploaded files if an error occurred after upload ---
             // This attempts to clean up temp files even if Cloudinary upload succeeded but DB save failed
             const filesToClean = [];
             if (govIdFile) filesToClean.push(govIdFile);
             if (passportPhotoFile) filesToClean.push(passportPhotoFile);
             if (biometricPhotoFile) filesToClean.push(biometricPhotoFile);
             if (digitalSignatureFile) filesToClean.push(digitalSignatureFile);
             filesToClean.forEach(file => {
                 if (fs.existsSync(file.path)) {
                      fs.unlink(file.path, (err) => {
                          if (err) console.error(`Error deleting temp file ${file.path} in error handler:`, err);
                          else console.log(`Cleaned up temp file: ${file.path} in error handler.`);
                      });
                 }
             });

            // Pass the error to the next error handling middleware
            next(error); // This sends the error to the app.use((err, req, res, next) => { ... }) block
        }
    }
);

// --- GET /submissions (Example endpoint - consider restricting access) ---
// This endpoint fetches all submissions. Useful for an admin view.
// Add authentication and authorization middleware here if needed.
app.get('/submissions', async (req, res, next) => { // Added next
    if (!db) {
         return res.status(503).json({ error: 'Database not available' });
    }
    try {
        const applicationsCollection = db.collection("applications"); // Fetching from 'applications'
        // Fetch submissions, potentially limit fields for performance/security
        const submissions = await applicationsCollection.find({}, {
                                       projection: {
                                           // Exclude sensitive file URLs from this general list endpoint
                                           govIdUrl: 0,
                                           passportPhotoUrl: 0,
                                           biometricPhotoUrl: 0,
                                           digitalSignatureUrl: 0
                                           // Include other fields you want to list
                                       }
                                   })
                                           .sort({ createdAt: -1 }) // Sort by creation date
                                           .toArray();

        console.log(`Workspaceed ${submissions.length} submissions.`); // Debugging
        res.json(submissions); // Respond with the list of submissions

    } catch (err) {
        console.error('Error fetching submissions:', err);
        // Pass error to the next error handling middleware
        next(err);
    }
});


// --- GET /api/user/dashboard (Endpoint for fetching dashboard data) ---
// This endpoint should provide data for the logged-in user's dashboard.
// Requires user authentication to identify the user.
app.get('/api/user/dashboard', async (req, res, next) => { // Added next
     console.log("Received request for /api/user/dashboard"); // Debugging

    // --- Authentication Middleware/Placeholder ---
    // In a real application, you would have middleware here to verify
    // the user's login status (e.g., check JWT token, session cookie).
    // If authentication fails, return res.status(401).json({ error: 'Unauthorized' });
    // If authentication succeeds, the user's identity/ID would be available,
    // typically attached to req.user or similar.
    // const authenticatedUserId = req.user ? req.user.id : null;

    // --- Authorization Placeholder ---
    // Ensure the user is authorized to access dashboard data.

    // --- TEMPORARY: Simulate a user ID for development ---
    // REMOVE THIS AND USE ACTUAL AUTHENTICATION IN PRODUCTION
    const temporarySimulatedUserId = new ObjectId('60f0f8f8f8f8f8f8f8f8f8f8'); // Replace with a valid ObjectId from your DB or remove
     console.warn(`🚨 Using temporary simulated user ID: ${temporarySimulatedUserId}. Replace with actual authentication.`);
    // Ensure this ID exists in your 'users' collection if you query by user ID later

    if (!db) {
        console.error("Database not connected when trying to fetch dashboard data.");
        return res.status(503).json({ error: 'Database not available' });
    }

    try {
         const applicationsCollection = db.collection("applications");
         const usersCollection = db.collection("users"); // Assuming a users collection
         const badgesCollection = db.collection("badges"); // Assuming a separate badges collection
         const tiersCollection = db.collection("membershipTiers"); // Assuming a tiers collection
         const contentCollection = db.collection("exclusiveContent"); // Assuming exclusive content collection

         // --- Fetch Data for the User ---
         // Find the user's application. You would typically query by user ID if authenticated.
         // For this temporary example, let's try to find an application by email or simulate finding one.
         // **REPLACE THIS QUERY WITH ONE BASED ON THE AUTHENTICATED USER'S ID**
         const userApplication = await applicationsCollection.findOne({ /* Query criteria based on authenticated user */ }); // Example: { userId: new ObjectId(authenticatedUserId) }

         let dashboardData = {
             user: { name: 'Guest' }, // Default user name
             application: { status: 'Not Applicable' },
             badge: null,
             membershipTier: null,
             exclusiveContent: []
         };

         // If an application is found for the user
         if (userApplication) {
             dashboardData.application = {
                 status: userApplication.applicationStatus || 'Unknown',
                 // Add other application details needed on dashboard
                 submissionDate: userApplication.createdAt // Example
             };

             // --- Fetch User's Profile (if separate user collection) ---
             // Example: Fetch user details using their ID from the application or authentication
             const userProfile = await usersCollection.findOne({ _id: userApplication.userId || temporarySimulatedUserId }); // Example query
             if(userProfile) {
                  dashboardData.user.name = userProfile.fullName || userProfile.name || 'User';
                  // Add other user profile data if needed
             } else {
                  // If no user profile found, try to use name from application
                   dashboardData.user.name = userApplication.fullName || 'User';
             }


             // --- Fetch Badge Data if Application is Approved ---
             if (userApplication.applicationStatus === 'Approved') {
                 // Find the badge linked to this application or user - **REPLACE THIS QUERY**
                 const userBadge = await badgesCollection.findOne({ applicationId: userApplication._id }); // Example: { userId: userApplication.userId }

                 if (userBadge) {
                     dashboardData.badge = {
                         id: userBadge.badge_id,
                         expirationDate: userBadge.expiration_date ? userBadge.expiration_date.toISOString().split('T')[0] : 'N/A', // Format date
                         qrCodeData: userBadge.qr_code_data || userBadge.badge_id, // Data for QR encoding
                         qrCodeUrl: userBadge.qr_code_url // Pre-generated QR image URL (if available)
                         // Add other badge visual data if needed
                     };
                 } else {
                     console.warn(`Application ${userApplication._id} is approved but no badge found.`);
                 }
             }

              // --- Fetch Membership Tier Details ---
              // Get the tier ID/name from the application or user profile
              const tierIdentifier = userApplication.membershipTier; // Assuming tier name/ID is stored in application
              if (tierIdentifier) {
                  // Fetch tier details from the tiers collection - **REPLACE THIS QUERY**
                  const tierDetails = await tiersCollection.findOne({ /* Query by tierIdentifier */ }); // Example: { name: tierIdentifier } or { _id: new ObjectId(tierIdentifier) }
                   if (tierDetails) {
                       dashboardData.membershipTier = {
                           name: tierDetails.name,
                           access_level: tierDetails.access_level // Use access level to filter content
                           // Add other tier details
                       };
                   } else {
                       console.warn(`Membership tier "${tierIdentifier}" not found.`);
                       dashboardData.membershipTier = { name: tierIdentifier || 'Unknown', access_level: 'none' };
                   }
              }


              // --- Fetch Exclusive Content based on Tier ---
              const requiredAccessLevel = dashboardData.membershipTier ? dashboardData.membershipTier.access_level : 'none';
              if (requiredAccessLevel && requiredAccessLevel !== 'none') {
                   // Find content accessible at or below the user's tier level - **REPLACE THIS QUERY**
                   // This logic depends heavily on how your tiers and content access are structured
                   dashboardData.exclusiveContent = await contentCollection.find({
                       // Example: find content where required_access_level is less than or equal to user's tier level
                       // This requires defining an order or hierarchy for access levels (e.g., 'none' < 'standard' < 'premium')
                       required_access_level: { $lte: requiredAccessLevel }
                   }).toArray(); // Example query

                   // Sort exclusive content (e.g., by date)
                   dashboardData.exclusiveContent.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); // Example sort
              }


         } else {
             // If no application is found, maybe the user hasn't applied yet
             console.log("No application found for the user.");
             dashboardData.application.status = 'Not Applied'; // Or a similar status
             // You might want to fetch basic user info here even without an application
             // Example: const userProfile = await usersCollection.findOne({ _id: new ObjectId(authenticatedUserId) });
             // if (userProfile) { dashboardData.user.name = userProfile.fullName || 'User'; }
         }

        // --- Send the structured dashboard data ---
        res.json(dashboardData);

    } catch (err) {
        console.error('Error fetching dashboard data:', err);
        // Pass error to the next error handling middleware
        next(err);
    }
});


// --- Add more API Endpoints here as needed ---
// Examples:
// app.post('/api/auth/register', ...) // User registration - Requires body parsing middleware
// app.post('/api/auth/login', ...)    // User login - Requires body parsing middleware and auth logic
// app.post('/api/user/update-profile', ...) // Update user info - Requires auth and validation
// app.get('/api/admin/applications', ...) // Admin view of all applications - Requires admin auth
// app.post('/api/admin/applications/:id/verify', ...) // Admin endpoint to mark application as verified - Requires admin auth
// app.post('/api/admin/applications/:id/approve', async (req, res, next) => { // Admin endpoint to approve & generate badge
//      // Requires admin auth and validation of application ID
//      // Fetch application by ID
//      // Update application status to 'Approved' in DB
//      // Generate Unique Badge ID (ensure uniqueness)
//      // Generate QR Code data (e.g., embed Badge ID or a verification URL)
//      // Save badge details (ID, expiry, QR data, user/application link) to 'badges' collection
//      // Respond with success
// });
// app.post('/api/admin/applications/:id/reject', ...) // Admin endpoint to reject application - Requires admin auth


// ============================
// Error Handling Middleware
// ============================
// This middleware catches errors from routes and other middleware
app.use((err, req, res, next) => {
    console.error("Caught unhandled error:", err.stack); // Log the full error stack

    // --- Handle specific error types ---

    // Multer errors (file upload errors)
    if (err instanceof multer.MulterError) {
        console.error(`Multer error: ${err.code} - ${err.message}`);
        return res.status(400).json({ error: `File upload error: ${err.message}` });
    }
     // Handle other file type errors from Multer's fileFilter
    if (err.message === 'Invalid file type. Only JPG, PNG, and PDF are allowed.') {
        console.error(`File filter error: ${err.message}`);
        return res.status(400).json({ error: err.message });
    }
     // Handle other potential file filter errors if you add more custom checks


    // Handle Mongoose/MongoDB specific errors if you implement Mongoose (e.g., validation)
    // if (err.name === 'ValidationError') { ... }


    // Handle other known error types (e.g., from express-validator if not handled in route)
    // Note: Validation errors from express-validator in the /submit-form route are handled there.


    // --- Default Error Response for unhandled errors ---
    // Use the status code from the error if it has one, otherwise default to 500
    const statusCode = err.status || 500;
    const errorMessage = err.message || 'An unexpected internal server error occurred.';

    // Send a generic error response
    res.status(statusCode).json({
        error: errorMessage,
        // In development, you might send the stack trace:
        // stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });
});


// ============================
// Start Server
// ============================
const PORT = process.env.PORT || 5000; // Use PORT from .env or default to 5000
app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
    console.log(`Serving static files from: ${frontendPath}`);
    console.log(`Uploads directory: ${uploadDir}`); // Log uploads directory
});