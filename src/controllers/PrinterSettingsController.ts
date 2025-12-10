import { Response } from 'express';
import { prisma } from '../models/db';
import { AuthRequest } from '../middleware/auth';

export class PrinterSettingsController {
    static async getSettings(req: AuthRequest, res: Response) {
        try {
            let settings = await prisma.printerSetting.findFirst({
                where: { id: 1 },
            });

            if (!settings) {
                // Create defaults
                settings = await prisma.printerSetting.create({
                    data: {
                        printerName: 'Default Printer',
                        printerType: 'thermal',
                        paperSize: '80mm',
                        autoPrint: true,
                        printCopies: 1,
                        showLogo: true,
                        showBarcode: false,
                        port: 9100
                    }
                });
            }

            return res.json(settings);
        } catch (error) {
            console.error('Get printer settings error:', error);
            return res.status(500).json({
                error: 'Internal server error',
                code: 'INTERNAL_ERROR',
            });
        }
    }

    static async updateSettings(req: AuthRequest, res: Response) {
        try {
            const data = req.body;
            // Clean payload (exclude id, createdAt, updatedAt from body if present)
            const { id, createdAt, updatedAt, ...updates } = data;

            const settings = await prisma.printerSetting.upsert({
                where: { id: 1 },
                update: { ...updates },
                create: {
                    ...updates,
                    printerName: updates.printerName || 'Default Printer',
                    printerType: updates.printerType || 'thermal',
                    // Ensure defaults if missing in updates for create
                }
            });

            return res.json(settings);
        } catch (error) {
            console.error('Update printer settings error:', error);
            return res.status(500).json({
                error: 'Internal server error',
                code: 'INTERNAL_ERROR',
            });
        }
    }
}
