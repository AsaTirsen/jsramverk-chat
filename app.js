const express = require('express');
const http = require("http");
const app = express();
const webSocketServer = require('websocket').server;
const server = http.createServer(app);
const wsServer = new webSocketServer({
    httpServer: server
});
const port = 1340;
const mongo = require("mongodb").MongoClient;
//const dsn = process.env.DBWEBB_DSN || "mongodb://localhost:27017/chat";
const dsn = process.env.DBWEBB_DSN || "mongodb://chat.asatirsen.me/chat";

console.log(port);

// Answer on all http requests
app.use(function (req, res) {
    res.send({msg: "hello"});
});

// This code generates unique userid for everyuser.
const getUniqueID = () => {
    const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
    return s4() + s4() + '-' + s4();
};

// I'm maintaining all active connections in this object
const clients = {};
// I'm maintaining all active users in this object
const users = {};
// The current editor content is maintained here.
let textBoxContent = null;
// User activity history.
let userActivity = [];
let activeUser;
let time;

function formatTime() {
    return new Date().getDate() + "/" + (new Date().getMonth() + 1) + " kl " + new Date().getHours() + ':' + ('0' + new Date().getMinutes()).slice(-2);
}

async function insertIntoMessages(colName, doc) {
    const client = await mongo.connect(dsn);
    const db = await client.db();
    const col = await db.collection(colName);
    await col.insertOne(doc);

    await client.close();
}


async function findInCollection(projection) {
    const client = await mongo.connect(dsn)
    const db = await client.db();
    const collection = await db.collection("messages");
    const cursor = await collection.find(projection)

    if (cursor.count() === 0) {
        console.log("no docs found");
    }

    let messageLog = await cursor.toArray();
    await client.close();
    return messageLog;
}

const sendMessage = (json) => {
    // We are sending the current data to all connected clients
    Object.keys(clients).map((client) => {
        clients[client].sendUTF(json);
    });
}

const typesDef = {
    USER_EVENT: "userevent",
    CONTENT_CHANGE: "contentchange"
}

wsServer.on('request', function (request) {
    var userID = getUniqueID();
    console.log((new Date()) + ' Recieved a new connection from origin ' + request.origin + '.');

    // You can rewrite this part of the code to accept only the requests from allowed origin
    const connection = request.accept(null, request.origin);
    clients[userID] = connection;
    console.log('connected: ' + userID + ' in ' + Object.getOwnPropertyNames(clients));
    connection.on('message', function (message) {
        if (message.type === 'utf8') {
            const dataFromClient = JSON.parse(message.utf8Data);
            const json = {type: dataFromClient.type};
            if (dataFromClient.type === typesDef.USER_EVENT) {
                // json.data = {users, userActivity};
                // sendMessage(JSON.stringify(json))
                (async () => {
                    let messageLog = await findInCollection("textBoxContent: 1");
                    users[userID] = dataFromClient;
                    userActivity.push(`${dataFromClient.username} joined the chat`);
                    json.data = {users, userActivity, messageLog: messageLog};
                    console.log(json.data);
                    sendMessage(JSON.stringify(json))
                })();

                // add try - catch
                // make sure works even if no message
            } else if (dataFromClient.type === typesDef.CONTENT_CHANGE) {
                textBoxContent = dataFromClient.content;
                activeUser = dataFromClient.username;
                time = formatTime();
                let dbInsert = {textBoxContent, activeUser, time}
                insertIntoMessages("messages", dbInsert)
                    .catch(err => console.log(err));
                json.data = {userActivity};
            }
            sendMessage(JSON.stringify(json));
        }
    });
    // user disconnected
    connection.on('close', function () {
        console.log((new Date()) + " Peer " + userID + " disconnected.");
        const json = {type: typesDef.USER_EVENT};
        if (users[userID]) {
            userActivity.push(`${users[userID].username} left the chat`);
        }
        json.data = {users, userActivity};
        delete clients[userID];
        delete users[userID];
        sendMessage(JSON.stringify(json));
    });
});

// Startup server
server.listen(port, () => {
    console.log(`Server is listening on ${port}`);
});

module.exports = server;
