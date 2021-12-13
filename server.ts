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

const path = require('path');
const fs = require('fs');
const { GraphQLUpload, graphqlUploadExpress } = require('graphql-upload');

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

require('dotenv').config();

const prisma = new PrismaClient();

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
  }
  type Query {
    currentUser: User!
    getPostsByUser(id: String): User!
    getAllMessages: [Chatroom]
    search(name: String): [User]
  }
  type Mutation {
    createUser(firstName: String, lastName: String, email: String, age: Int, password: String): User
    login(email: String, password: String): AuthPayload
    singleUpload(file: Upload!): File!
    createPost(link: String, content: String, imageUrl: String): Post
    message(receiver: ID, content: String): Message
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
            firstName: true,
            id: true,
            email: true,
            lastName: true,
            posts: true,
            friends: {
              select: {
                status: true,
                lastName: true,
                firstName: true,
                id: true,
                posts: true,
                friends: {
                  select: {
                    lastName: true,
                    firstName: true,
                    age: true,
                    email: true,
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
    getPostsByUser: async (_parent, args) => {
      const User = await prisma.user.findUnique({
        where: {
          id: args.id,
        },
        select: {
          firstName: true,
          lastName: true,
          age: true,
          posts: true,
          email: true,
        },
      });
      return User;
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
    search: async (_parent, args) => {
      console.log('search', args);
      const Users = await prisma.user.findMany({
        where: {
          OR: [
            {
              firstName: {
                contains: args.name,
              },
              lastName: {
                contains: args.name,
              },
            },
          ],
        },
      });
      console.log(Users);
      return Users;
    },
  },
  Mutation: {
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
      const stream = createReadStream();
      const pathName = path.join(__dirname, `/public/images/${filename}`);
      await stream.pipe(fs.createWriteStream(pathName));
      return {
        url: `http://localhost:4000/images/${filename}`,
      };
    },
    createPost: async (_parent, args, context) => {
      const newPost = await prisma.post.create({
        data: {
          authorId: context.id,
          imageUrl: args.imageUrl,
          content: args.content,
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
  },
  Subscription: {
    message: {
      subscribe: withFilter(
        () => pubsub.asyncIterator('NEW_MESSAGE'),
        // eslint-disable-next-line max-len
        (payload, _variables, { id }) => (payload.message.receivedBy.id === id || payload.message.createdBy.id === id),
      ),
      // subscribe: () => { pubsub.asyncIterator(['NEW_MESSAGE']); },
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
        },
      });
      console.log(user);
      return user;
    },
  },
  User: {
    post: async ({ posts }) => posts,
    friends: async ({ friends }) => friends,
  },
  Post: {
    author: async (parent) => {
      const User = await prisma.user.findUnique({
        where: {
          id: parent.authorId,
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      });
      return User;
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
};

(async function startApolloServer(typeDefs, resolvers) {
  const app = express();
  const schema = makeExecutableSchema({ typeDefs, resolvers });
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
  app.use(express.static('public'));
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
