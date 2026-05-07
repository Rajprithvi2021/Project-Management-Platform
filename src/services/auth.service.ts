import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database';
import { config } from '../config';
import { createError } from '../middleware/errorHandler';

export class AuthService {
  static async register(params: {
    email: string;
    password: string;
    displayName: string;
  }) {
    const existing = await prisma.user.findFirst({
      where: { email: params.email, deletedAt: null },
    });
    if (existing) throw createError('Email already registered', 409);

    const hashedPassword = await bcrypt.hash(params.password, 12);

    const user = await prisma.user.create({
      data: {
        email: params.email,
        password: hashedPassword,
        displayName: params.displayName,
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        createdAt: true,
      },
    });

    const token = this.generateToken(user.id, user.email, user.role);
    return { user, token };
  }

  static async login(email: string, password: string) {
    const user = await prisma.user.findFirst({ where: { email, deletedAt: null } });
    if (!user || !user.isActive) throw createError('Invalid credentials', 401);

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) throw createError('Invalid credentials', 401);

    const token = this.generateToken(user.id, user.email, user.role);
    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        avatarUrl: user.avatarUrl,
      },
      token,
    };
  }

  static async getProfile(userId: string) {
    const user = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        avatarUrl: true,
        createdAt: true,
        projectMemberships: {
          include: { project: { select: { id: true, key: true, name: true } } },
        },
        workspaceMemberships: {
          include: { workspace: { select: { id: true, name: true } } },
        },
      },
    });
    if (!user) throw createError('User not found', 404);
    return user;
  }

  static async updateProfile(userId: string, data: {
    displayName?: string;
    avatarUrl?: string;
    password?: string;
  }) {
    const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) throw createError('User not found', 404);

    const updateData: Record<string, unknown> = {};
    if (data.displayName) updateData.displayName = data.displayName;
    if (data.avatarUrl) updateData.avatarUrl = data.avatarUrl;
    if (data.password) updateData.password = await bcrypt.hash(data.password, 12);

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        avatarUrl: true,
        createdAt: true,
      },
    });

    return updatedUser;
  }

  private static generateToken(userId: string, email: string, role: string) {
    return jwt.sign(
      { id: userId, email, role },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn as any }
    );
  }
}
