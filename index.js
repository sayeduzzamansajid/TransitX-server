require('dotenv').config()
const express = require('express')
const cors = require('cors')
const { MongoClient, ServerApiVersion } = require('mongodb')
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

      console.log("user exists---->", !!alreadyExist);

      if (alreadyExist) {
        console.log("updating user info-->");
        const result = await userCollection.updateOne(query, {
          $set: {
            last_loggedIn: new Date().toISOString()
          }
        })
        return res.send(result)
      }

      //saving to mongodb
      console.log("saving new user-->");
      const result = await userCollection.insertOne(userData)

      console.log(userData);


      res.send(userData)
    });
    //get user role 
    app.get('/user/role/:email', async(req,res)=>{
      const email = req?.params?.email;
      const result = await userCollection.findOne({email})
      res.send({role: result?.role})
    })

















    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 })
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    )
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
