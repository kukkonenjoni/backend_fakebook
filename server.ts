/* eslint-disable no-param-reassign */
import { ApolloServer, gql } from 'apollo-server-express';
import { ApolloServerPluginDrainHttpServer, UserInputError } from 'apollo-server-core';
import express from 'express';
import http from 'http';
import { PrismaClient, Prisma } from '@prisma/client';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

require('dotenv').config();

const prisma = new PrismaClient();

const typeDefs = gql`
  type Book {
    title: String
    author: String
  }
  type User {
    id: ID
    email: String
    age: Int
    first_name: String
    last_name: String
    password: String
  }
  type AuthPayload {
    token: String
    user: User
  }
  type Query {
    books: [Book]
  }
  type Mutation {
    createUser(first_name: String, last_name: String, email: String, age: Int, password: String): User
    login(email: String, password: String): AuthPayload
  }
`;

const resolvers = {
  Query: {
    books: async (_parent, args, context) => {
      if (args) {
        throw new UserInputError('asd');
      }
      return context;
    },
  },
  Mutation: {
    createUser: async (_parent, args) => {
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
      const match = await bcrypt.compare(args.password, user?.password).then((res) => res);
      if (user && match) {
        const token = await jwt.sign({ id: user.id, email: user.email }, process.env.SECRET);
        return { token, id: user.id };
      }
      throw new UserInputError('Invalid credentials');
    },
  },
  AuthPayload: {
    user: async (parent, args) => {
      console.log(args);
      console.log(parent);
      const user = await prisma.user.findUnique({
        where: {
          id: parent.id,
        },
        select: {
          id: true,
          email: true,
          first_name: true,
          last_name: true,
          age: true,
        },
      });
      return user;
    },
  },
};

(async function startApolloServer(typeDefs, resolvers) {
  const app = express();

  app.use(cors());

  const httpServer = http.createServer(app);
  const server = new ApolloServer({
    typeDefs,
    resolvers,
    plugins: [ApolloServerPluginDrainHttpServer({ httpServer })],
    context: ({ req }) => {
      const token = req.headers.authorization || '';
      const user = token || 'Joni';
      return { user };
    },
  });
  await server.start();
  server.applyMiddleware({ app });

  app.use((_req, _res, next) => {
    console.log(Date.now());
    next();
  });

  // eslint-disable-next-line no-promise-executor-return
  await new Promise<void>((resolve) => httpServer.listen({ port: process.env.PORT }, resolve));
  console.log(`🚀 Server ready at http://localhost:4000${server.graphqlPath}`);
}(typeDefs, resolvers));
