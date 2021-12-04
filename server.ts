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
  type Book {
    title: String
    author: String
  }
  type User {
    id: ID
    email: String
    age: Int
    firstName: String
    lastName: String
    password: String
    post: [Post]
    friends: [User]
    messages: [Message]
  }
  type Message {
    receiver: User
    sender: User
    content: String
  }
  type AuthPayload {
    token: String
    user: User
  }
  type Post {
    imageUrl: String
    author: User
    content: String
    createdAt: String
    link: String
  }
  type Query {
    books: [Book]
    currentUser: User!
    getPostsByUser(id: String): User!
  }
  type Mutation {
    createUser(firstName: String, lastName: String, email: String, age: Int, password: String): User
    login(email: String, password: String): AuthPayload
    singleUpload(file: Upload!): File!
    createPost(link: String, content: String, imageUrl: String): Post
    message(receiver: ID, sender: ID, content: String ): Message
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
            lastName: true,
            age: true,
            email: true,
            posts: true,
            friends: {
              select: {
                lastName: true,
                firstName: true,
                id: true,
                email: true,
                age: true,
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
    message: async (_parent, args) => {
      pubsub.publish('NEW_MESSAGE', { message: args });
      return args;
    },
  },
  Subscription: {
    message: {
      subscribe: withFilter(
        () => pubsub.asyncIterator(['NEW_MESSAGE']),
        (_payload, _variables, { id }) => {
          console.log(id);
          return true;
        },
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
        },
      });
      return user;
    },
  },
  User: {
    post: async (parent) => parent.posts,
    friends: async ({ friends }) => friends,
  },
  Post: {
    author: async (parent) => {
      const User = await prisma.user.findUnique({
        where: {
          id: parent.authorId,
        },
        select: {
          firstName: true,
          lastName: true,
        },
      });
      return User;
    },
  },
  Message: {
    receiver: async (parent) => {
      const User = prisma.user.findUnique({
        where: {
          id: parent.receiver,
        },
      });
      return User;
    },
    sender: async (parent) => {
      const User = prisma.user.findUnique({
        where: {
          id: parent.sender,
        },
      });
      return User;
    },
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
      onConnect(connectionParams) {
        console.log(connectionParams.Authorization);
        console.log('Connected!');
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
