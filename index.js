require('dotenv').config()
const express = require('express')
const cors = require('cors')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const admin = require('firebase-admin')
const port = process.env.PORT || 3000
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString(
  'utf-8'
)
const serviceAccount = JSON.parse(decoded)
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
})

const app = express()

// middleware
app.use(
  cors({
    origin: [
      'http://localhost:5173',
      'http://localhost:5174',
      'https://transitx.pages.dev',
      'https://transitx-a11.netlify.app'

    ],
    credentials: true,
    optionSuccessStatus: 200,
  })
)
app.use(express.json())

// jwt middlewares
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(' ')[1]
  console.log(token)
  if (!token) return res.status(401).send({ message: 'Unauthorized Access!' })
  try {
    const decoded = await admin.auth().verifyIdToken(token)
    req.tokenEmail = decoded.email
    console.log(decoded)
    next()
  } catch (err) {
    console.log(err)
    return res.status(401).send({ message: 'Unauthorized Access!', err })
  }
}

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})


async function run() {
  try {


    //save a plant in db 
    const db = client.db('TransitX');
    const userCollection = db.collection('user');
    const allTicketCollection = db.collection('tickets');

    // save new user or Update existing user in database 
    app.post('/user', async (req, res) => {
      //getting data from request 
      const userData = req.body;

      userData.created_at = new Date().toISOString();
      userData.last_loggedIn = new Date().toISOString();
      userData.role = 'user'

      const query = { email: userData?.email }
      //checking user exist or not 
      const alreadyExist = await userCollection.findOne(query);

      // console.log("user exists---->", !!alreadyExist);

      if (alreadyExist) {
        // console.log("updating user info-->");
        const result = await userCollection.updateOne(query, {
          $set: {
            last_loggedIn: new Date().toISOString()
          }
        })
        return res.send(result)
      }

      //saving to mongodb
      // console.log("saving new user-->");
      const result = await userCollection.insertOne(userData)

      // console.log(userData);


      res.send(userData)
    });
    //get user role 
    app.get('/user/role/:email', async (req, res) => {
      const email = req?.params?.email;
      const result = await userCollection.findOne({ email })
      res.send({ role: result?.role })
    })


    //Public/Home Page API's <-------------------------------------------->  PUBLIC  <------------------------------------------>


    // Only approved tickets for All Tickets page
    app.get('/tickets/approved', async (req, res) => {
      const result = await allTicketCollection
        .find({ verificationStatus: "approved" })
        .toArray();
      res.send(result);
    });

    //get ticked details page id based
    app.get("/tickets/:id", async (req, res) => {
      try {
        const id = req.params.id;

        const ticket = await allTicketCollection.findOne({
          _id: new ObjectId(id),
          verificationStatus: "approved", // remove this filter if you want vendors to see their own pending ticket details
        });

        if (!ticket) {
          return res.status(404).send({ message: "Ticket not found" });
        }

        res.send(ticket);
      } catch (err) {
        console.error("GET /tickets/:id error", err);
        res.status(500).send({ message: "Failed to load ticket" });
      }
    });



    //User Site API's <-------------------------------------------->  USER  <------------------------------------------>

    // POST /bookings  (user must be logged in)
    app.post("/bookings", verifyJWT, async (req, res) => {
      try {
        const payload = req.body;
        const tokenEmail = req.tokenEmail;

        // basic security: userEmail must match token email
        if (payload.userEmail !== tokenEmail) {
          return res.status(403).send({ message: "Forbidden" });
        }

        const ticketId = new ObjectId(payload.ticketId);

        // load ticket to validate quantity and departure
        const ticket = await allTicketCollection.findOne({ _id: ticketId });

        if (!ticket) {
          return res.status(404).send({ message: "Ticket not found" });
        }

        // check departure not passed
        const departureDate = new Date(ticket.departure);
        if (departureDate.getTime() <= Date.now()) {
          return res
            .status(400)
            .send({ message: "Departure time has already passed" });
        }

        // check quantity
        const requestedQty = Number(payload.bookingQuantity);
        if (requestedQty < 1) {
          return res.status(400).send({ message: "Quantity must be at least 1" });
        }
        if (requestedQty > ticket.quantity) {
          return res
            .status(400)
            .send({ message: "Booking quantity cannot exceed ticket quantity" });
        }

        const bookingDoc = {
          userEmail: payload.userEmail,
          userName: payload.userName,
          ticketId,
          ticketTitle: ticket.title,
          bookingQuantity: requestedQty,
          unitPrice: ticket.price,
          totalPrice: ticket.price * requestedQty,
          status: "pending", // force pending
          sellerEmail: ticket.seller?.email,
          departureTime: ticket.departure,
          createdAt: new Date().toISOString(),
        };

        const result = await bookingsCollection.insertOne(bookingDoc);

        res.send({ insertedId: result.insertedId, booking: bookingDoc });
      } catch (err) {
        console.error("POST /bookings error", err);
        res.status(500).send({ message: "Failed to create booking" });
      }
    });






    //Vendor site API's <------------------------------------------->   VENDOR  <-------------------------------------->

    //add a ticket/ post ticket
    app.post('/tickets', async (req, res) => {
      const ticketData = req.body;
      ticketData.verificationStatus = 'pending';

      console.log(ticketData);

      const result = await allTicketCollection.insertOne(ticketData)
      res.send(result)
    })



    //vendor's Addeded tickets
    app.get('/my-tickets/:email', verifyJWT, async (req, res) => {
      const email = req.params.email;
      const tokenEmail = req.tokenEmail;

      if (email !== tokenEmail) {
        return res.status(403).send({ message: "Forbidden" });
      }

      const result = await allTicketCollection
        .find({ "seller.email": email })
        .toArray();

      res.send(result);
    });



    //Admin site API's <-------------------------------------------------->  ADMIN  <---------------------------------------->

    //getting all user in database
    // GET all tickets (admin)
    app.get('/tickets', verifyJWT, async (req, res) => {
      const result = await allTicketCollection.find().toArray();
      res.send(result);
    });

    // Approve ticket that is posted by vendor 
    app.patch('/tickets/:id/approve', verifyJWT, async (req, res) => {
      const id = req.params.id;
      const result = await allTicketCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { verificationStatus: "approved" } }
      );
      console.log(result);
      res.send(result);
    });


    // Reject ticket that is posted by vendor 
    app.patch('/tickets/:id/reject', verifyJWT, async (req, res) => {
      const id = req.params.id;
      const result = await allTicketCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { verificationStatus: "rejected" } }
      );
      res.send(result);
    });






















    // Send a ping to confirm a successful connection
    // await client.db('admin').command({ ping: 1 })
    // console.log(
    //   'Pinged your deployment. You successfully connected to MongoDB!'
    // )
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Hello from Server..')
})

app.listen(port, () => {
  console.log(`Server is running on port ${port}`)
})
