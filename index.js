require("dotenv").config();
const express = require("express");
const app = express();
const cors = require("cors");
const PORT = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

// Middleware
app.use(express.json());
app.use(cors());

const admin = require("firebase-admin");
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf8",
);
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({ message: "unauthorized token" });
  }

  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);

    req.decoded_email = decoded.email;
    req.staffEmail = decoded.email; // ✅ ADD THIS

    next();
  } catch (err) {
    return res.status(401).send({ message: "unauthorized token" });
  }
};

// MongoDB connection string
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.qqb9b6u.mongodb.net/public-db?retryWrites=true&w=majority`;

// MongoClient
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Routes
app.get("/", (req, res) => {
  res.send("Hello, backend server is running!");
});
async function run() {
  try {
    const db = client.db("public-db");
    const publicCollection = db.collection("publics");
    const citizenCollection = db.collection("citizen");
    const staffCollection = db.collection("staff");
    const issuesCollection = db.collection("issues");
    const timelineCollection = db.collection("timeline");
    const postCollection = db.collection("posts");

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await citizenCollection.findOne(query);
      if (user?.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };
    // USER APIs
    // ==============================================

    app.get("/citizen", async (req, res) => {
      const searchText = req.query.search;
      // console.log(searchText);

      const quary = {};
      if (searchText) {
        quary.displayName = { $regex: new RegExp(searchText, "i") };
        quary.$or = [
          { displayName: { $regex: searchText, $option: "i" } },
          { email: { $regex: searchText, $option: "i" } },
        ];
      }
      const cursor = citizenCollection
        .find(quary)
        .limit(5)
        .sort({ createdAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });
    app.post("/citizen", async (req, res) => {
      const user = req.body;
      user.role = "citizen";
      user.createdAt = new Date();
      const email = user.email;
      const userExists = await citizenCollection.findOne({ email });
      if (userExists) {
        return res.send({ message: "citizen already exists" });
      }
      const result = await citizenCollection.insertOne(user);
      res.send(result);
    });
    app.patch(
      "/citizen/:id/role",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const role = req.body.role;
        const quary = { _id: new ObjectId(id) };
        const update = {
          $set: {
            role: role,
          },
        };
        const result = await citizenCollection.updateOne(quary, update);
        res.send(result);
      },
    );
    app.get("/citizens/:email/role", async (req, res) => {
      try {
        const email = req.params.email;

        const user = await citizenCollection.findOne({ email });

        if (!user) {
          return res.status(404).send({ role: "citizen" });
        }
        res.send({
          role: user.role || "citizen",
        });
      } catch (error) {
        console.error("Error fetching citizen role:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    app.get("/citizen/:email", async (req, res) => {
      const email = req.params.email;
      const result = await citizenCollection.findOne({ email });
      res.send(result);
    });
    // Make user premium after payment
    app.put("/citizen/premium/:email", async (req, res) => {
      const email = req.params.email;
      const result = await citizenCollection.updateOne(
        { email },
        { $set: { premium: true } },
      );
      res.send(result);
    });
    app.patch(
      "/citizen/block/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const { blocked } = req.body;

        const result = await citizenCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { blocked } },
        );
        res.send(result);
      },
    );
    app.patch(
      "/issues/assign/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const issueId = req.params.id;
        const { staffEmail, staffName } = req.body;

        const result = await issuesCollection.updateOne(
          { _id: new ObjectId(issueId) },
          {
            $set: {
              assignedStaff: { staffEmail, staffName },
              status: "pending",
            },
          },
        );

        await timelineCollection.insertOne({
          issueId: new ObjectId(issueId),
          status: "Assigned",
          message: `Assigned to staff ${staffName}`,
          updatedBy: "Admin",
          timestamp: new Date(),
        });

        res.send(result);
      },
    );

    app.get("/staff", async (req, res) => {
      const cursor = staffCollection.find().sort({ createdAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });
    app.post("/staff", async (req, res) => {
      const user = req.body;
      user.createdAt = new Date();

      const email = user.staffEmail;

      const userExists = await staffCollection.findOne({ staffEmail: email });
      if (userExists) {
        return res.send({ message: "staff already exists" });
      }

      const result = await staffCollection.insertOne(user);
      res.send(result);
    });

    app.patch("/issues/status/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;

      const result = await issuesCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } },
      );

      await timelineCollection.insertOne({
        issueId: new ObjectId(id),
        status,
        message: `Status changed to ${status}`,
        updatedBy: "Staff",
        timestamp: new Date(),
      });

      res.send(result);
    });
    app.get("/staff/assigned-issues", verifyToken, async (req, res) => {
      const staffEmail = req.decoded_email; // ✅ reliable

      const result = await issuesCollection
        .find({ "assignedStaff.staffEmail": staffEmail })
        .sort({ createdAt: -1 })
        .toArray();



        
      res.send(result);
    });

    app.patch("/issues/resolve/:id", async (req, res) => {
      const id = req.params.id;

      const result = await issuesCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            status: "resolved",
            resolvedAt: new Date(),
          },
        },
      );

      // timeline entry (optional but recommended)
      await timelineCollection.insertOne({
        issueId: new ObjectId(id),
        status: "Resolved",
        message: "Issue has been resolved",
        updatedBy: "Admin",
        timestamp: new Date(),
      });

      res.send(result);
    });

    app.patch("/issues/upvote/:id", verifyToken, async (req, res) => {
      const issueId = req.params.id;
      const email = req.decoded_email;

      const issue = await issuesCollection.findOne({
        _id: new ObjectId(issueId),
      });

      if (issue.upvotes?.includes(email)) {
        return res.status(400).send({ message: "Already upvoted" });
      }

      await issuesCollection.updateOne(
        { _id: new ObjectId(issueId) },
        {
          $push: { upvotes: email },
          $inc: { upvoteCount: 1 },
        },
      );

      res.send({ success: true });
    });
    app.get("/all-issues", async (req, res) => {
      const page = parseInt(req.query.page) || 1;
      const limit = 10;
      const skip = (page - 1) * limit;

      const result = await issuesCollection
        .find()
        .skip(skip)
        .limit(limit)
        .toArray();

      res.send(result);
    });

    app.patch("/staff/:id", verifyToken, verifyAdmin, async (req, res) => {
      const { status, email } = req.body;
      const id = req.params.id;
      // 1️⃣ staff collection update
      const staffQuery = { _id: new ObjectId(id) };
      const staffUpdate = {
        $set: {
          status: status,
          workStatus: "available",
        },
      };

      const staffResult = await staffCollection.updateOne(
        staffQuery,
        staffUpdate,
      );

      // 2️⃣ approve হলে citizen/user collection এ role set
      if (status === "approved") {
        const userQuery = { email };
        const userUpdate = {
          $set: {
            role: "staff",
          },
        };

        await citizenCollection.updateOne(userQuery, userUpdate);
      }
      res.send({
        success: true,
        staffResult,
      });
    });
    app.delete("/staff/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const result = await staffCollection.deleteOne({ _id: new ObjectId(id) });

      if (result.deletedCount > 0) {
        return res.send({
          success: true,
          message: "Staff deleted successfully",
        });
      } else {
        return res
          .status(404)
          .send({ success: false, message: "Staff not found" });
      }
    });

    app.get("/admin/users", verifyToken, verifyAdmin, async (req, res) => {
      const users = await citizenCollection.find().toArray();
      res.send(users);
    });
    app.patch(
      "/admin/users/block/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const { blocked } = req.body;

        const result = await citizenCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { blocked } },
        );

        res.send(result);
      },
    );

    app.post("/posts", verifyToken, async (req, res) => {
      const post = {
        title: req.body.title,
        description: req.body.description,
        email: req.user.email, // Firebase user email
        uid: req.user.uid, // Firebase UID
        createdAt: new Date(),
      };

      const result = await postCollection.insertOne(post);
      res.send(result);
    });
    // Create Issue used
    app.post("/issues", async (req, res) => {
      const data = req.body;
      data.createdAt = new Date();

      const result = await issuesCollection.insertOne(data);

      // 🔹 Timeline auto entry
      await timelineCollection.insertOne({
        issueId: result.insertedId,
        status: "Issue reported",
        message: "Issue reported by citizen",
        updatedBy: "Citizen",
        timestamp: new Date(),
      });

      res.send(result);
    });

    // Get All Public Issues
    app.get("/issues", async (req, res) => {
      const issues = await issuesCollection.find().toArray();

      const totalIssues = issues.length;
      const pending = issues.filter((i) => i.status === "pending").length;
      const resolved = issues.filter((i) => i.status === "resolved").length;

      res.send({
        totalIssues,
        pending,
        resolved,
      });
    });
    app.get("/staff/stats", verifyToken, async (req, res) => {
      const staffEmail = req.staffEmail;

      const assigned = await issuesCollection.countDocuments({
        "assignedStaff.staffEmail": staffEmail,
      });

      const resolved = await issuesCollection.countDocuments({
        "assignedStaff.staffEmail": staffEmail,
        status: "resolved",
      });

      const today = await issuesCollection.countDocuments({
        "assignedStaff.staffEmail": staffEmail,
        createdAt: {
          $gte: new Date(new Date().setHours(0, 0, 0, 0)),
          $lte: new Date(new Date().setHours(23, 59, 59, 999)),
        },
      });

      res.send({ assigned, resolved, today });
    });

    // Staff can update their assigned issue status
    app.patch("/issues/:id/status", verifyToken, async (req, res) => {
      const issueId = req.params.id;
      const { status } = req.body;
      const staffEmail = req.staffEmail;

      const issue = await issuesCollection.findOne({
        _id: new ObjectId(issueId),
      });

      if (!issue) return res.status(404).send({ message: "Issue not found" });

      if (issue.assignedStaff?.staffEmail !== staffEmail)
        return res.status(403).send({ message: "Not assigned to you" });

      // Update status
      await issuesCollection.updateOne(
        { _id: new ObjectId(issueId) },
        { $set: { status } },
      );

      // Add timeline record
      await timelineCollection.insertOne({
        issueId: new ObjectId(issueId),
        status,
        message: `Status changed to ${status}`,
        updatedBy: staffEmail,
        timestamp: new Date(),
      });

      res.send({ success: true });
    });

    app.patch("/issues/reject/:id", async (req, res) => {
      const id = req.params.id;

      const result = await issuesCollection.updateOne(
        { _id: new ObjectId(id), status: "pending" },
        {
          $set: { status: "rejected" },
          $push: {
            timeline: {
              action: "Issue Rejected",
              date: new Date(),
            },
          },
        },
      );

      res.send(result);
    });

    app.get("/my-issues/:email", async (req, res) => {
      try {
        const email = req.params.email;

        const result = await issuesCollection
          .find({ userEmail: email })
          .sort({ createdAt: -1 })
          .toArray();

        res.send(result);
      } catch (error) {
        console.error("Error fetching my issues:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Get latest 6 issues
    app.get("/latest-issues", async (req, res) => {
      const result = await issuesCollection
        .find()
        .sort({ createdAt: -1 })
        .limit(6)
        .toArray();
      res.send(result);
    });

    // Get single issue
    app.get("/issues/:id", async (req, res) => {
      const id = req.params.id;
      const result = await issuesCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // Get My Issues (filter by email)
    app.get("/issuess/:email", async (req, res) => {
      try {
        const { email } = req.params;
        const result = await issuesCollection
          .find({ userEmail: email })
          .toArray();
        res.send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server Error" });
      }
    });
    // Backend route: /dashboard/citizen-stats/:email
    app.get("/issues/citizen-stats/:email", async (req, res) => {
      const email = req.params.email;

      const totalIssues = await issuesCollection.countDocuments({
        userEmail: email,
      });
      const pending = await issuesCollection.countDocuments({
        userEmail: email,
        status: "pending",
      });
      const resolved = await issuesCollection.countDocuments({
        userEmail: email,
        status: "resolved",
      });

      res.send({ totalIssues, pending, resolved });
    });

    // Edit Issue
    app.put("/issues/:id", async (req, res) => {
      const id = req.params.id;
      const updateData = req.body;

      const result = await issuesCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updateData },
      );

      res.send(result);
    });

    // Delete Issue
    app.delete("/issues/:id", async (req, res) => {
      const id = req.params.id;
      const result = await issuesCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    app.get("/timeline/:issueId", async (req, res) => {
      const issueId = new ObjectId(req.params.issueId);
      const result = await timelineCollection
        .find({ issueId })
        .sort({ timestamp: -1 })
        .toArray();
      res.send(result);
    });

    app.get("/publics", async (req, res) => {
      const result = await publicCollection.find().toArray();
      res.send(result);
    });

    app.get("/latest-issus", async (req, res) => {
      const cursor = publicCollection.find().sort({ createdAt: -1 }).limit(6);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/issues/:id", async (req, res) => {
      const cursor = publicCollection.find().sort({ createdAt: -1 }).limit(6);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.post("/publics", async (req, res) => {
      const issus = req.body;
      const result = await publicCollection.insertOne(issus);
      res.send(result);
    });

    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!",
    // );
  } catch (err) {
    console.error(err);
  }
}
run().catch(console.dir);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
