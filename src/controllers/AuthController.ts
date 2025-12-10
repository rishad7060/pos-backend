import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../models/db';
import { z } from 'zod';
import { logAudit } from '../middleware/audit-logger';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  fullName: z.string().min(1),
  role: z.enum(['admin', 'manager', 'cashier']).default('cashier')
});

const pinLoginSchema = z.object({
  pin: z.string().min(4)
});

export class AuthController {
  static async login(req: Request, res: Response) {
    try {
      const { email, password } = loginSchema.parse(req.body);

      // Normalize email to lowercase for case-insensitive comparison
      const normalizedEmail = email.trim().toLowerCase();

      // Query user by email
      const user = await prisma.user.findUnique({
        where: { email: normalizedEmail }
      });

      // Check if user exists
      if (!user) {
        console.error('Login failed: User not found for email:', normalizedEmail);
        return res.status(401).json({
          error: 'Invalid email or password',
          code: 'INVALID_CREDENTIALS'
        });
      }

      // Check if user has permission to login with email/password (only managers and admins)
      if (user.role === 'cashier') {
        console.error('Login failed: Cashiers cannot login with email/password, user:', user.id);
        return res.status(403).json({
          error: 'Cashiers must use PIN login',
          code: 'CASHIER_PIN_REQUIRED'
        });
      }

      // Verify password using bcrypt
      const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

      if (!isPasswordValid) {
        console.error('Login failed: Invalid password for user:', user.id);
        return res.status(401).json({
          error: 'Invalid email or password',
          code: 'INVALID_CREDENTIALS'
        });
      }

      // Generate JWT token
      const token = jwt.sign(
        {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role
        },
        process.env.JWT_SECRET!,
        { expiresIn: '24h' }
      );

      // Record user session
      try {
        await prisma.userSession.create({
          data: {
            userId: user.id,
            loginMethod: 'password',
            ipAddress: req.ip || req.connection.remoteAddress,
            userAgent: req.get('User-Agent'),
            registryOpened: false,
          },
        });

        // Log successful login to audit log
        await logAudit(user.id, {
          action: 'LOGIN_SUCCESS',
          entityType: 'User',
          entityId: user.id,
          notes: `User logged in via password authentication`,
        }, req);
      } catch (sessionError) {
        console.error('Failed to record login session:', sessionError);
        // Don't fail login if session recording fails
      }

      // Successful authentication - return user data without passwordHash
      const { passwordHash, ...userWithoutPassword } = user;

      return res.json({
        user: userWithoutPassword,
        token,
        message: 'Login successful'
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: error.issues
        });
      }

      console.error('Login error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR'
      });
    }
  }

  static async register(req: Request, res: Response) {
    try {
      const { email, password, fullName, role } = registerSchema.parse(req.body);

      // Check if user already exists
      const existingUser = await prisma.user.findUnique({
        where: { email: email.trim().toLowerCase() }
      });

      if (existingUser) {
        return res.status(409).json({
          error: 'User with this email already exists',
          code: 'USER_EXISTS'
        });
      }

      // Hash password
      const saltRounds = 12;
      const passwordHash = await bcrypt.hash(password, saltRounds);

      // Create user
      const user = await prisma.user.create({
        data: {
          email: email.trim().toLowerCase(),
          passwordHash,
          fullName,
          role,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      });

      // Generate JWT token
      const token = jwt.sign(
        {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role
        },
        process.env.JWT_SECRET!,
        { expiresIn: '24h' }
      );

      const { passwordHash: _, ...userWithoutPassword } = user;

      return res.status(201).json({
        user: userWithoutPassword,
        token,
        message: 'User registered successfully'
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: error.issues
        });
      }

      console.error('Register error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR'
      });
    }
  }

  static async pinLogin(req: Request, res: Response) {
    try {
      const { pin } = pinLoginSchema.parse(req.body);

      // Find user by PIN
      const cashierPin = await prisma.cashierPin.findFirst({
        where: {
          pin,
          isActive: true
        },
        include: {
          user: true
        }
      });

      if (!cashierPin) {
        return res.status(401).json({
          error: 'Invalid PIN',
          code: 'INVALID_PIN'
        });
      }

      const user = cashierPin.user;

      // Generate JWT token
      const token = jwt.sign(
        {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role
        },
        process.env.JWT_SECRET!,
        { expiresIn: '24h' }
      );

      // Record user session
      try {
        await prisma.userSession.create({
          data: {
            userId: user.id,
            loginMethod: 'pin',
            ipAddress: req.ip || req.connection.remoteAddress,
            userAgent: req.get('User-Agent'),
            registryOpened: false,
          },
        });
      } catch (sessionError) {
        console.error('Failed to record PIN login session:', sessionError);
        // Don't fail login if session recording fails
      }

      const { passwordHash, ...userWithoutPassword } = user;

      return res.json({
        user: userWithoutPassword,
        token,
        message: 'PIN login successful'
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: error.issues
        });
      }

      console.error('PIN login error:', error);
      console.error('Error details:', error instanceof Error ? error.message : error);
      console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}


