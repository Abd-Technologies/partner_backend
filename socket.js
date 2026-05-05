// socket.js

const { sendUpcomingSlotNotificationToUser } = require('./helper/crownjobfunction');


let io;

module.exports = {
  init: (server) => {
    const { Server } = require("socket.io");
    io = new Server(server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"],
      },
      transports: ['websocket'],
      pingTimeout: 30000,
      pingInterval: 10000,
    });

io.on("connection", (socket) => {
  console.log("🔌 User connected: " + socket.id);

  // Community feed room — clients call joinCommunity once they open the feed
  // so newPost / postApproved / postDeleted reach only interested clients.
  socket.on("joinCommunity", () => socket.join("community"));
  socket.on("leaveCommunity", () => socket.leave("community"));

  // Per-post room — used while a client has a single post / its replies open.
  // Scopes replyWithUser and toggleLike events to viewers of that post.
  socket.on("joinPost", (postId) => {
    if (postId !== undefined && postId !== null) socket.join(`post_${postId}`);
  });
  socket.on("leavePost", (postId) => {
    if (postId !== undefined && postId !== null) socket.leave(`post_${postId}`);
  });

  socket.on("getSlot", async (data) => {
    console.log(`📥 Received 'getSlot' request from ${socket.id} with data:`, data);

    try {
      const slot = await sendUpcomingSlotNotificationToUser(data.id);
      console.log(`🔎 Slot data fetched for user ${data.id}:`, slot);

      if (slot !== null) {
        console.log(`📤 Sending slot data back to client ${socket.id}`);
        socket.emit("slotUpdate", slot);
      } else {
        console.log(`⚠️ No upcoming slot found for user ${data.id}`);
        socket.emit("slotUpdate", null);
      }
    } catch (error) {
      console.error("❌ Error fetching slot:", error);
      socket.emit("slotError", { message: "Failed to fetch slot." });
    }
  });
});



    return io;
  },
getIO: () => {
  if (!io) {
    console.error("❌ Socket.io not initialized!");
    throw new Error("Socket.io not initialized!");
  }
  console.log("✅ Socket.io instance retrieved");
  return io;
},
};
