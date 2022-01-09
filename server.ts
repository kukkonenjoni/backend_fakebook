/* eslint-disable camelcase */
/* eslint-disable no-param-reassign */
import { ApolloServer, gql } from 'apollo-server-express';
import { ApolloServerPluginDrainHttpServer, UserInputError } from 'apollo-server-core';
import express from 'express';
import { createServer } from 'http';
import { PrismaClient, Prisma } from '@prisma/client';
import { execute, subscribe } from 'graphql';
import { SubscriptionServer } from 'subscriptions-transport-ws';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { PubSub, withFilter } from 'graphql-subscriptions';

const { Storage } = require('@google-cloud/storage');

const path = require('path');
const fs = require('fs');
const { GraphQLUpload, graphqlUploadExpress } = require('graphql-upload');

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

require('dotenv').config();

const prisma = new PrismaClient();
const storage = new Storage();
const bucket = storage.bucket(process.env.GCLOUD_STORAGE_BUCKET);

const uploadToGoogleCloud = (createReadStream, filename: string): Promise<void> =>
  // step 1 - upload the file to Google Cloud Storage
  new Promise((resolves, rejects) => createReadStream()
    .pipe(bucket.file(filename).createWriteStream({
      resumable: false,
      gzip: true,
    }))
    .on('error', (err: any) => rejects(err)) // reject on error
    .on('finish', resolves)) // resolve on finish
;

const typeDefs = gql`

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
const pubsub = new PubSub();
const resolvers = {
  Upload: GraphQLUpload,
  Query: {
    currentUser: async (_parent, _args, { id }) => {
      if (id) {
        const User = await prisma.user.findUnique({
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
    },
    getAllMessages: async (_parent, _args, { id }) => {
      const chatrooms = await prisma.messagesMiddleware.findMany({
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
    },
    search: async (_parent, { name }) => {
      console.log('search', name);
      const Users = await prisma.user.findMany({
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
    },
    getUser: async (_parent, { userId }, { id }) => {
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
    },
    getPost: async (_parent, { postId }, { id }) => {
      console.log(id);
      const Post = await prisma.post.findUnique({
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
    },
  },
  Mutation: {
    like: async (_parent, { postId }, { id }) => {
      console.log(postId);
      console.log(id);
      let hasLiked = false;
      const Post = await prisma.post.findUnique({
        where: {
          id: postId,
        },
        select: {
          likes: true,
        },
      });
      Post?.likes.forEach((user) => {
        if (user.userId === id) {
          hasLiked = true;
        }
      });
      if (!hasLiked) {
        await prisma.likesOnPost.create({
          data: {
            userId: id,
            postId,
          },
        });
        const Post2 = await prisma.post.findUnique({
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
    },
    createUser: async (_parent, args) => {
      const {
        password, email, firstName, lastName, age,
      } = args;
      if (!password || !email || !firstName || !lastName || !age) {
        throw new UserInputError('Please fill all fields');
      }
      try {
        args.password = await bcrypt.hash(args.password, 12);
        const newUser = await prisma.user.create({
          data: args,
        });
        return newUser;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError) {
          if (e.code === 'P2002') {
            throw new UserInputError('Email Already Exists!');
          }
        }
        throw new UserInputError('Unknown Error');
      }
    },
    login: async (_parent, args) => {
      if (!args.password || !args.email) {
        throw new UserInputError('Please Fill both fields');
      }
      const user = await prisma.user.findUnique({
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
        throw new UserInputError('Invalid credentials');
      }
      const match: boolean = await bcrypt.compare(args.password, user?.password).then((res) => res);
      if (user && match) {
        // eslint-disable-next-line max-len
        const token: string = await jwt.sign({ id: user.id }, process.env.SECRET);
        return { token, id: user.id };
      }
      throw new UserInputError('Invalid credentials');
    },
    singleUpload: async (_parent, { file }) => {
      const {
        createReadStream, filename,
      } = await file;
      try {
        await uploadToGoogleCloud(createReadStream, filename);
      } catch (e) {
        console.log(e);
      }
      return {
        url: `https://storage.googleapis.com/cobalt-baton-337015-bucket/${filename}`,
      };
    },
    createPost: async (_parent, args, context) => {
      const newPost = await prisma.post.create({
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
    },
    message: async (_parent, { content, receiver }, { id }) => {
      let chatroom;
      chatroom = await prisma.messagesMiddleware.findFirst({
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
        chatroom = await prisma.messagesMiddleware.create({
          data: {
            user1Id: id,
            user2Id: receiver,
          },
        });
      }
      const newMessage = await prisma.message.create({
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
    },
    sendFriendReq: async (_parent, { friendId }, { id }) => {
      console.log(id);
      const User = await prisma.user.update({
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
    },
    acceptFriendReq: async (_parent, { friendId }, { id }) => {
      console.log('You: ', id);
      console.log('Him: ', friendId);
      const you = await prisma.user.findUnique({
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
      const verifyFriend = you?.received_friendreq.filter((friend) => {
        if (friend.id === friendId) {
          return friend;
        }
        return null;
      });
      if (verifyFriend !== undefined && verifyFriend.length === 1) {
        const him = await prisma.user.update({
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
        const you = await prisma.user.update({
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
        await prisma.messagesMiddleware.create({
          data: {
            user1Id: you.id,
            user2Id: him.id,
          },
        });
        return him;
      }
      return null;
    },
    editUser: async (_parent, {
      profilePic, age, firstName, lastName, bio,
    }, { id }) => {
      const User = await prisma.user.findUnique({
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
          profilePic: profilePic || User?.profilePic,
          age: age || User?.age,
          firstName: firstName || User?.firstName,
          lastName: lastName || User?.lastName,
          bio: bio || User?.bio,
        },
      });
      return newUser;
    },
    comment: async (_parent, { postId, content }, { id }) => {
      console.log(postId, id, content);
      const comment = await prisma.comment.create({
        data: {
          authorId: id,
          comment: content,
          postId,
        },
      });
      console.log(comment);
      return comment;
    },
  },
  Subscription: {
    message: {
      subscribe: withFilter(
        () => pubsub.asyncIterator('NEW_MESSAGE'),
        // eslint-disable-next-line max-len
        (payload, _variables, { id }) => (payload.message.receivedBy.id === id || payload.message.createdBy.id === id),
      ),
    },
  },
  AuthPayload: {
    user: async (parent) => {
      const user = await prisma.user.findUnique({
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
    },
  },
  User: {
    post: async ({ posts }) => {
      console.log(posts);
      return posts;
    },
    friends: async ({ friends }) => friends,
    sent_friendreq: ({ sent_friendreq }) => sent_friendreq,
    received_friendreq: ({ received_friendreq }) => received_friendreq,
  },
  Post: {
    author: async (parent) => {
      const User = await prisma.user.findUnique({
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
    },
    likes: async ({ likes }) => {
      console.log(likes);
      const newLikes = likes.map((user) => ({ id: user.userId }));
      return newLikes;
    },
    comments: async ({ comments }) => {
      console.log(comments);
      return comments;
    },
  },
  Chatroom: {
    messages: ({ messages }) => messages,
    user1: ({ user1 }) => user1,
    user2: ({ user2 }) => user2,
  },
  Message: {
    chatroom: async (parent) => ({ id: parent.chatroom }),
    createdBy: async ({ createdBy }) => createdBy,
    receivedBy: async ({ receivedBy }) => receivedBy,
  },
  Comment: {
    author: async ({ authorId }) => {
      console.log(authorId);
      const User = await prisma.user.findUnique({
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
    },
  },
};

(async function startApolloServer(typeDefs, resolvers) {
  const app = express();
  const schema = makeExecutableSchema({ typeDefs, resolvers });
  app.options('*', cors());
  app.use(cors());
  const httpServer = createServer(app);
  const server = new ApolloServer({
    typeDefs,
    resolvers,
    plugins: [
      ApolloServerPluginDrainHttpServer({ httpServer }),
      {
        async serverWillStart() {
          return {
            async drainServer() {
              // eslint-disable-next-line no-use-before-define
              subscriptionServer.close();
            },
          };
        },
      },
    ],
    context: async ({ req }): Promise<{ id: string; } | null> => {
      const bearerToken = req.headers.authorization || '';
      const token: string[] = bearerToken.split(' ');
      if (token[0] === 'Bearer' && token[1]) {
        try {
          const tokenId = await jwt.verify(token[1], process.env.SECRET);
          const user = await prisma.user.findUnique({
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
        } catch {
          return null;
        }
      }
      return null;
    },
  });
  await server.start();
  app.use(graphqlUploadExpress());
  app.use(express.static(path.join(__dirname, 'public')));
  app.use(express.static(path.join(__dirname, 'build/public')));
  server.applyMiddleware({ app });
  const subscriptionServer = SubscriptionServer.create(
    {
      schema,
      execute,
      subscribe,
      async onConnect(connectionParams) {
        try {
          const tokenId = await jwt.verify(connectionParams.authToken, process.env.SECRET);
          const user = await prisma.user.findUnique({
            where: {
              id: tokenId.id,
            },
            select: {
              id: true,
            },
          });
          if (user) {
            const { id } = user;
            await prisma.user.update({
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
        } catch {
          return null;
        }
        return null;
      },
      async onDisconnect(_websocket, context) {
        if (context.initPromise) {
          const ctxUser = await context.initPromise;
          if (ctxUser) {
            await prisma.user.update({
              where: {
                id: ctxUser.id,
              },
              data: {
                status: false,
              },
            });
            console.log(`User ${ctxUser?.id} Disconnected`);
          }
        }
      },
    },
    { server: httpServer, path: server.graphqlPath },
  );
  // eslint-disable-next-line no-promise-executor-return
  await new Promise<void>((resolve) => httpServer.listen({ port: process.env.PORT }, resolve));
  console.log(`🚀 Server ready at http://localhost:4000${server.graphqlPath}`);
  console.log(
    `🚀 Subscription endpoint ready at ws://localhost:4000${server.graphqlPath}`,
  );
}(typeDefs, resolvers));
