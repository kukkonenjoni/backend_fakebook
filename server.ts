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
    firstName: String
    lastName: String
    password: String
  }
  type AuthPayload {
    token: String
    user: User
  }
  type Query {
    books: [Book]
    currentUser: User!
  }
  type Mutation {
    createUser(firstName: String, lastName: String, email: String, age: Int, password: String): User
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
    currentUser: async (_parent, _args, { id }) => {
      console.log(id);
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
          },
        });
        return User;
      }
      return null;
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
    login: async (_parent, args, context) => {
      console.log(context);
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
};

(async function startApolloServer(typeDefs, resolvers) {
  const app = express();

  app.use(cors());

  const httpServer = http.createServer(app);
  const server = new ApolloServer({
    typeDefs,
    resolvers,
    plugins: [ApolloServerPluginDrainHttpServer({ httpServer })],
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
  server.applyMiddleware({ app });

  app.use((_req, _res, next) => {
    console.log(Date.now());
    next();
  });

  // eslint-disable-next-line no-promise-executor-return
  await new Promise<void>((resolve) => httpServer.listen({ port: process.env.PORT }, resolve));
  console.log(`🚀 Server ready at http://localhost:4000${server.graphqlPath}`);
}(typeDefs, resolvers));
