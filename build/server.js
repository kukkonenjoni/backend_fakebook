"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable camelcase */
/* eslint-disable no-param-reassign */
const apollo_server_express_1 = require("apollo-server-express");
const apollo_server_core_1 = require("apollo-server-core");
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const client_1 = require("@prisma/client");
const graphql_1 = require("graphql");
const subscriptions_transport_ws_1 = require("subscriptions-transport-ws");
const schema_1 = require("@graphql-tools/schema");
const graphql_subscriptions_1 = require("graphql-subscriptions");
const { Storage } = require('@google-cloud/storage');
const path = require('path');
const fs = require('fs');
const { GraphQLUpload, graphqlUploadExpress } = require('graphql-upload');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config();
const prisma = new client_1.PrismaClient();
const storage = new Storage();
const bucket = storage.bucket(process.env.GCLOUD_STORAGE_BUCKET);
const uploadToGoogleCloud = (createReadStream, filename) => 
// step 1 - upload the file to Google Cloud Storage
new Promise((resolves, rejects) => createReadStream()
    .pipe(bucket.file(filename).createWriteStream({
    resumable: false,
    gzip: true,
}))
    .on('error', (err) => rejects(err)) // reject on error
    .on('finish', resolves)) // resolve on finish
;
const typeDefs = (0, apollo_server_express_1.gql) `

  scalar Upload

  type File {
    url: String!
  }
  type User {
    id: ID
    email: String
    age: Int
    firstName: String
    lastName: String
    password: String
    status: Boolean
    post: [Post]
    friends: [User]
    messages: [Chatroom]
    profilePic: String
    sent_friendreq: [User]
    received_friendreq: [User]
    bio: String
  }
  type Chatroom {
    id: ID
    user1: User
    user2: User
    messages: [Message]
  }
  type Message {
    id: ID
    createdAt: String
    createdBy: User
    receivedBy: User
    chatroom: Chatroom
    messagecontent: String
  }
  type AuthPayload {
    token: String
    user: User
  }
  type Post {
    id: ID
    imageUrl: String
    author: User
    content: String
    createdAt: String
    link: String
    likes: [User]
    comments: [Comment]
  }
  type Comment {
    id: ID
    author: User
    comment: String
    post: Post
  }
  type Query {
    currentUser: User
    getUser(userId: ID): User!
    getAllMessages: [Chatroom]
    search(name: String): [User]
    getPost(postId: Int): Post
  }
  type Mutation {
    createUser(firstName: String, lastName: String, email: String, age: Int, password: String): User
    login(email: String, password: String): AuthPayload
    singleUpload(file: Upload!): File!
    createPost(link: String, content: String, imageUrl: String): Post
    message(receiver: ID, content: String): Message
    sendFriendReq(friendId: ID): User
    acceptFriendReq(friendId: ID): User
    editUser(profilePic: String, age: Int, bio: String, firstName: String, lastName: String): User
    like(postId: Int): Post
    comment(postId: Int, content: String): Comment
  }
  type Subscription {
    message: Message
  }
`;
const pubsub = new graphql_subscriptions_1.PubSub();
const resolvers = {
    Upload: GraphQLUpload,
    Query: {
        currentUser: (_parent, _args, { id }) => __awaiter(void 0, void 0, void 0, function* () {
            if (id) {
                const User = yield prisma.user.findUnique({
                    where: {
                        id,
                    },
                    select: {
                        profilePic: true,
                        firstName: true,
                        id: true,
                        email: true,
                        lastName: true,
                        posts: {
                            select: {
                                id: true,
                                comments: true,
                                content: true,
                                link: true,
                                imageUrl: true,
                                authorId: true,
                                createdAt: true,
                                likes: true,
                            },
                        },
                        sent_friendreq: {
                            select: {
                                id: true,
                                firstName: true,
                                lastName: true,
                                profilePic: true,
                            },
                        },
                        received_friendreq: {
                            select: {
                                id: true,
                                firstName: true,
                                lastName: true,
                                profilePic: true,
                            },
                        },
                        friends: {
                            select: {
                                profilePic: true,
                                status: true,
                                lastName: true,
                                firstName: true,
                                id: true,
                                posts: {
                                    select: {
                                        id: true,
                                        comments: true,
                                        content: true,
                                        link: true,
                                        imageUrl: true,
                                        authorId: true,
                                        createdAt: true,
                                        likes: true,
                                    },
                                },
                            },
                        },
                    },
                });
                return User;
            }
            return null;
        }),
        getAllMessages: (_parent, _args, { id }) => __awaiter(void 0, void 0, void 0, function* () {
            const chatrooms = yield prisma.messagesMiddleware.findMany({
                where: {
                    OR: [
                        {
                            user1Id: id,
                        },
                        {
                            user2Id: id,
                        },
                    ],
                },
                select: {
                    messages: {
                        select: {
                            receivedBy: true,
                            createdBy: true,
                            id: true,
                            messagecontent: true,
                        },
                    },
                    id: true,
                    user1: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                        },
                    },
                    user2: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                        },
                    },
                },
            });
            return chatrooms;
        }),
        search: (_parent, { name }) => __awaiter(void 0, void 0, void 0, function* () {
            console.log('search', name);
            const Users = yield prisma.user.findMany({
                where: {
                    OR: [
                        {
                            firstName: {
                                contains: name,
                            },
                        },
                        {
                            lastName: {
                                contains: name,
                            },
                        },
                    ],
                },
                select: {
                    firstName: true,
                    lastName: true,
                    id: true,
                    age: true,
                    profilePic: true,
                },
            });
            console.log(Users);
            return Users;
        }),
        getUser: (_parent, { userId }, { id }) => __awaiter(void 0, void 0, void 0, function* () {
            console.log(id);
            const User = prisma.user.findUnique({
                where: {
                    id: userId,
                },
                include: {
                    posts: {
                        include: {
                            likes: true,
                        },
                        orderBy: {
                            createdAt: 'desc',
                        },
                    },
                },
            });
            return User;
        }),
        getPost: (_parent, { postId }, { id }) => __awaiter(void 0, void 0, void 0, function* () {
            console.log(id);
            const Post = yield prisma.post.findUnique({
                where: {
                    id: postId,
                },
                include: {
                    likes: true,
                    comments: {
                        orderBy: {
                            createdAt: 'desc',
                        },
                    },
                },
            });
            return Post;
        }),
    },
    Mutation: {
        like: (_parent, { postId }, { id }) => __awaiter(void 0, void 0, void 0, function* () {
            console.log(postId);
            console.log(id);
            let hasLiked = false;
            const Post = yield prisma.post.findUnique({
                where: {
                    id: postId,
                },
                select: {
                    likes: true,
                },
            });
            Post === null || Post === void 0 ? void 0 : Post.likes.forEach((user) => {
                if (user.userId === id) {
                    hasLiked = true;
                }
            });
            if (!hasLiked) {
                yield prisma.likesOnPost.create({
                    data: {
                        userId: id,
                        postId,
                    },
                });
                const Post2 = yield prisma.post.findUnique({
                    where: {
                        id: postId,
                    },
                    select: {
                        id: true,
                        likes: true,
                    },
                });
                return Post2;
            }
            return null;
        }),
        createUser: (_parent, args) => __awaiter(void 0, void 0, void 0, function* () {
            const { password, email, firstName, lastName, age, } = args;
            if (!password || !email || !firstName || !lastName || !age) {
                throw new apollo_server_core_1.UserInputError('Please fill all fields');
            }
            try {
                args.password = yield bcrypt.hash(args.password, 12);
                const newUser = yield prisma.user.create({
                    data: args,
                });
                return newUser;
            }
            catch (e) {
                if (e instanceof client_1.Prisma.PrismaClientKnownRequestError) {
                    if (e.code === 'P2002') {
                        throw new apollo_server_core_1.UserInputError('Email Already Exists!');
                    }
                }
                throw new apollo_server_core_1.UserInputError('Unknown Error');
            }
        }),
        login: (_parent, args) => __awaiter(void 0, void 0, void 0, function* () {
            if (!args.password || !args.email) {
                throw new apollo_server_core_1.UserInputError('Please Fill both fields');
            }
            const user = yield prisma.user.findUnique({
                where: {
                    email: args.email,
                },
                select: {
                    id: true,
                    email: true,
                    password: true,
                },
            });
            if (!user) {
                throw new apollo_server_core_1.UserInputError('Invalid credentials');
            }
            const match = yield bcrypt.compare(args.password, user === null || user === void 0 ? void 0 : user.password).then((res) => res);
            if (user && match) {
                // eslint-disable-next-line max-len
                const token = yield jwt.sign({ id: user.id }, process.env.SECRET);
                return { token, id: user.id };
            }
            throw new apollo_server_core_1.UserInputError('Invalid credentials');
        }),
        singleUpload: (_parent, { file }) => __awaiter(void 0, void 0, void 0, function* () {
            const { createReadStream, filename, } = yield file;
            try {
                yield uploadToGoogleCloud(createReadStream, filename);
            }
            catch (e) {
                console.log(e);
            }
            return {
                url: `https://storage.googleapis.com/cobalt-baton-337015-bucket/${filename}`,
            };
        }),
        createPost: (_parent, args, context) => __awaiter(void 0, void 0, void 0, function* () {
            const newPost = yield prisma.post.create({
                data: {
                    authorId: context.id,
                    imageUrl: args.imageUrl,
                    content: args.content,
                },
                select: {
                    imageUrl: true,
                    content: true,
                    id: true,
                    likes: true,
                    createdAt: true,
                    authorId: true,
                    link: true,
                },
            });
            return newPost;
        }),
        message: (_parent, { content, receiver }, { id }) => __awaiter(void 0, void 0, void 0, function* () {
            let chatroom;
            chatroom = yield prisma.messagesMiddleware.findFirst({
                where: {
                    OR: [
                        {
                            user1Id: id,
                            user2Id: receiver,
                        },
                        {
                            user1Id: receiver,
                            user2Id: id,
                        },
                    ],
                },
                select: {
                    id: true,
                    user1Id: true,
                    user2Id: true,
                    messages: true,
                },
            });
            if (!chatroom) {
                chatroom = yield prisma.messagesMiddleware.create({
                    data: {
                        user1Id: id,
                        user2Id: receiver,
                    },
                });
            }
            const newMessage = yield prisma.message.create({
                data: {
                    createdById: id,
                    receivedById: receiver,
                    messagecontent: content,
                    messagemiddlewareId: chatroom.id,
                },
                select: {
                    id: true,
                    createdBy: {
                        select: {
                            id: true,
                        },
                    },
                    receivedBy: {
                        select: {
                            id: true,
                        },
                    },
                    createdAt: true,
                    messagecontent: true,
                    messagemiddlewareId: true,
                },
            });
            pubsub.publish('NEW_MESSAGE', {
                message: {
                    id: newMessage.id,
                    createdBy: newMessage.createdBy,
                    receivedBy: newMessage.receivedBy,
                    createdAt: newMessage.createdAt,
                    chatroom: newMessage.messagemiddlewareId,
                    messagecontent: newMessage.messagecontent,
                },
            });
            return newMessage;
        }),
        sendFriendReq: (_parent, { friendId }, { id }) => __awaiter(void 0, void 0, void 0, function* () {
            console.log(id);
            const User = yield prisma.user.update({
                where: {
                    id,
                },
                data: {
                    sent_friendreq: {
                        connect: { id: friendId },
                    },
                },
                select: {
                    sent_friendreq: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                        },
                    },
                },
            });
            console.log(User);
            return { id };
        }),
        acceptFriendReq: (_parent, { friendId }, { id }) => __awaiter(void 0, void 0, void 0, function* () {
            console.log('You: ', id);
            console.log('Him: ', friendId);
            const you = yield prisma.user.findUnique({
                where: {
                    id,
                },
                select: {
                    received_friendreq: {
                        select: {
                            id: true, firstName: true, lastName: true,
                        },
                    },
                },
            });
            const verifyFriend = you === null || you === void 0 ? void 0 : you.received_friendreq.filter((friend) => {
                if (friend.id === friendId) {
                    return friend;
                }
                return null;
            });
            if (verifyFriend !== undefined && verifyFriend.length === 1) {
                const him = yield prisma.user.update({
                    where: {
                        id: friendId,
                    },
                    data: {
                        friends: {
                            connect: { id },
                        },
                        sent_friendreq: {
                            disconnect: { id },
                        },
                    },
                    select: {
                        status: true,
                        firstName: true,
                        lastName: true,
                        id: true,
                    },
                });
                const you = yield prisma.user.update({
                    where: {
                        id,
                    },
                    data: {
                        friends: {
                            connect: { id: friendId },
                        },
                        received_friendreq: {
                            disconnect: { id: friendId },
                        },
                    },
                    select: {
                        id: true,
                    },
                });
                yield prisma.messagesMiddleware.create({
                    data: {
                        user1Id: you.id,
                        user2Id: him.id,
                    },
                });
                return him;
            }
            return null;
        }),
        editUser: (_parent, { profilePic, age, firstName, lastName, bio, }, { id }) => __awaiter(void 0, void 0, void 0, function* () {
            const User = yield prisma.user.findUnique({
                where: {
                    id,
                },
                select: {
                    profilePic: true,
                    age: true,
                    firstName: true,
                    lastName: true,
                    bio: true,
                },
            });
            const newUser = prisma.user.update({
                where: {
                    id,
                },
                data: {
                    profilePic: profilePic || (User === null || User === void 0 ? void 0 : User.profilePic),
                    age: age || (User === null || User === void 0 ? void 0 : User.age),
                    firstName: firstName || (User === null || User === void 0 ? void 0 : User.firstName),
                    lastName: lastName || (User === null || User === void 0 ? void 0 : User.lastName),
                    bio: bio || (User === null || User === void 0 ? void 0 : User.bio),
                },
            });
            return newUser;
        }),
        comment: (_parent, { postId, content }, { id }) => __awaiter(void 0, void 0, void 0, function* () {
            console.log(postId, id, content);
            const comment = yield prisma.comment.create({
                data: {
                    authorId: id,
                    comment: content,
                    postId,
                },
            });
            console.log(comment);
            return comment;
        }),
    },
    Subscription: {
        message: {
            subscribe: (0, graphql_subscriptions_1.withFilter)(() => pubsub.asyncIterator('NEW_MESSAGE'), 
            // eslint-disable-next-line max-len
            (payload, _variables, { id }) => (payload.message.receivedBy.id === id || payload.message.createdBy.id === id)),
        },
    },
    AuthPayload: {
        user: (parent) => __awaiter(void 0, void 0, void 0, function* () {
            const user = yield prisma.user.findUnique({
                where: {
                    id: parent.id,
                },
                select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                    age: true,
                    friends: {
                        select: {
                            firstName: true,
                            lastName: true,
                            id: true,
                            status: true,
                        },
                    },
                    sent_friendreq: {
                        select: {
                            id: true,
                            lastName: true,
                            firstName: true,
                        },
                    },
                    received_friendreq: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            profilePic: true,
                        },
                    },
                },
            });
            console.log(user);
            return user;
        }),
    },
    User: {
        post: ({ posts }) => __awaiter(void 0, void 0, void 0, function* () {
            console.log(posts);
            return posts;
        }),
        friends: ({ friends }) => __awaiter(void 0, void 0, void 0, function* () { return friends; }),
        sent_friendreq: ({ sent_friendreq }) => sent_friendreq,
        received_friendreq: ({ received_friendreq }) => received_friendreq,
    },
    Post: {
        author: (parent) => __awaiter(void 0, void 0, void 0, function* () {
            const User = yield prisma.user.findUnique({
                where: {
                    id: parent.authorId,
                },
                select: {
                    id: true,
                    profilePic: true,
                    firstName: true,
                    lastName: true,
                },
            });
            return User;
        }),
        likes: ({ likes }) => __awaiter(void 0, void 0, void 0, function* () {
            console.log(likes);
            const newLikes = likes.map((user) => ({ id: user.userId }));
            return newLikes;
        }),
        comments: ({ comments }) => __awaiter(void 0, void 0, void 0, function* () {
            console.log(comments);
            return comments;
        }),
    },
    Chatroom: {
        messages: ({ messages }) => messages,
        user1: ({ user1 }) => user1,
        user2: ({ user2 }) => user2,
    },
    Message: {
        chatroom: (parent) => __awaiter(void 0, void 0, void 0, function* () { return ({ id: parent.chatroom }); }),
        createdBy: ({ createdBy }) => __awaiter(void 0, void 0, void 0, function* () { return createdBy; }),
        receivedBy: ({ receivedBy }) => __awaiter(void 0, void 0, void 0, function* () { return receivedBy; }),
    },
    Comment: {
        author: ({ authorId }) => __awaiter(void 0, void 0, void 0, function* () {
            console.log(authorId);
            const User = yield prisma.user.findUnique({
                where: {
                    id: authorId,
                },
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    profilePic: true,
                },
            });
            console.log(User);
            return User;
        }),
    },
};
(function startApolloServer(typeDefs, resolvers) {
    return __awaiter(this, void 0, void 0, function* () {
        const app = (0, express_1.default)();
        const schema = (0, schema_1.makeExecutableSchema)({ typeDefs, resolvers });
        app.options('*', cors());
        app.use(cors());
        const httpServer = (0, http_1.createServer)(app);
        const server = new apollo_server_express_1.ApolloServer({
            typeDefs,
            resolvers,
            plugins: [
                (0, apollo_server_core_1.ApolloServerPluginDrainHttpServer)({ httpServer }),
                {
                    serverWillStart() {
                        return __awaiter(this, void 0, void 0, function* () {
                            return {
                                drainServer() {
                                    return __awaiter(this, void 0, void 0, function* () {
                                        // eslint-disable-next-line no-use-before-define
                                        subscriptionServer.close();
                                    });
                                },
                            };
                        });
                    },
                },
            ],
            context: ({ req }) => __awaiter(this, void 0, void 0, function* () {
                const bearerToken = req.headers.authorization || '';
                const token = bearerToken.split(' ');
                if (token[0] === 'Bearer' && token[1]) {
                    try {
                        const tokenId = yield jwt.verify(token[1], process.env.SECRET);
                        const user = yield prisma.user.findUnique({
                            where: {
                                id: tokenId.id,
                            },
                            select: {
                                id: true,
                            },
                        });
                        if (user) {
                            const { id } = user;
                            return { id };
                        }
                    }
                    catch (_a) {
                        return null;
                    }
                }
                return null;
            }),
        });
        yield server.start();
        app.use(graphqlUploadExpress());
        app.use(express_1.default.static(path.join(__dirname, 'public')));
        app.use(express_1.default.static(path.join(__dirname, 'build/public')));
        server.applyMiddleware({ app });
        const subscriptionServer = subscriptions_transport_ws_1.SubscriptionServer.create({
            schema,
            execute: graphql_1.execute,
            subscribe: graphql_1.subscribe,
            onConnect(connectionParams) {
                return __awaiter(this, void 0, void 0, function* () {
                    try {
                        const tokenId = yield jwt.verify(connectionParams.authToken, process.env.SECRET);
                        const user = yield prisma.user.findUnique({
                            where: {
                                id: tokenId.id,
                            },
                            select: {
                                id: true,
                            },
                        });
                        if (user) {
                            const { id } = user;
                            yield prisma.user.update({
                                where: {
                                    id,
                                },
                                data: {
                                    status: true,
                                },
                            });
                            console.log(`User ${id} Connected`);
                            return { id };
                        }
                    }
                    catch (_a) {
                        return null;
                    }
                    return null;
                });
            },
            onDisconnect(_websocket, context) {
                return __awaiter(this, void 0, void 0, function* () {
                    if (context.initPromise) {
                        const ctxUser = yield context.initPromise;
                        if (ctxUser) {
                            yield prisma.user.update({
                                where: {
                                    id: ctxUser.id,
                                },
                                data: {
                                    status: false,
                                },
                            });
                            console.log(`User ${ctxUser === null || ctxUser === void 0 ? void 0 : ctxUser.id} Disconnected`);
                        }
                    }
                });
            },
        }, { server: httpServer, path: server.graphqlPath });
        // eslint-disable-next-line no-promise-executor-return
        yield new Promise((resolve) => httpServer.listen({ port: process.env.PORT }, resolve));
        console.log(`🚀 Server ready at http://localhost:4000${server.graphqlPath}`);
        console.log(`🚀 Subscription endpoint ready at ws://localhost:4000${server.graphqlPath}`);
    });
}(typeDefs, resolvers));
