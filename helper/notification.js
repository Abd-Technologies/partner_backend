const admin = require('firebase-admin');
const serviceAccount = require('../fither-e7a36-2145b07b5e5a.json');

// Initialize Firebase Admin SDK using the service account JSON file
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Function to send notification using Firebase Admin SDK
module.exports = async function sendNotification(to, notificationValue, data = {}) {

  try {
    // Note: Using sendMulticast requires a flat object with tokens, not within the message
    const response = await admin.messaging().sendEachForMulticast({
      tokens: to, // Pass tokens directly here
      notification:notificationValue, // Pass notification separately
      data:data, // Pass data separately
    });
    // const response = await admin.messaging().sendMulticast(message); // Use sendMulticast instead of sendEachForMulticast

    console.log(JSON.stringify(response));
  } catch (error) {
    console.error('Error sending message:', error);
  }
}


/**
 * 🔔 Send notification to a Firebase Topic
 * @param {string} topicName - The Firebase topic name (e.g. "userPlan")
 * @param {Object} notificationValue - { title, body, image }
 * @param {Object} data - Optional custom payload
 */
module.exports.sendTopicNotification = async function sendTopicNotification(topicName, notificationValue, data = {}) {
  try {
    const message = {
      topic: topicName,
      notification: notificationValue,
      data: data,
    };

    const response = await admin.messaging().send(message);
    console.log(`✅ Notification sent to topic "${topicName}":`, response);
  } catch (error) {
    console.error(`❌ Error sending topic notification:`, error);
  }
};