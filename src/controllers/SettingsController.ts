import { Response } from 'express';
import { prisma } from '../models/db';
import { AuthRequest } from '../middleware/auth';
import { decimalToNumber } from '../utils/decimal';

export class SettingsController {
    static async getSettings(req: AuthRequest, res: Response) {
        try {
            // Get business settings (should only be one record)
            let businessSettings = await prisma.businessSetting.findFirst();

            // If no settings exist, create default ones
            if (!businessSettings) {
                businessSettings = await prisma.businessSetting.create({
                    data: {
                        businessName: 'My POS Store',
                        address: '',
                        phone: '',
                        email: '',
                        taxRate: 0,
                        logoUrl: '',
                        receiptFooter: 'Thank you for your business!',
                        creditDueDays: 7,
                        enableCreditAlerts: true,
                    },
                });
            }

            // Get printer settings
            let printerSettings = await prisma.printerSetting.findFirst();

            // If no printer settings exist, create default ones
            if (!printerSettings) {
                printerSettings = await prisma.printerSetting.create({
                    data: {
                        printerName: 'Default Printer',
                        printerType: 'thermal',
                        paperSize: '80mm',
                        autoPrint: true,
                        printCopies: 1,
                        showLogo: true,
                        showBarcode: false,
                    },
                });
            }

            // Convert Decimal to numbers
            const serialized = {
                business: {
                    ...businessSettings,
                    taxRate: decimalToNumber(businessSettings.taxRate) ?? 0,
                },
                printer: printerSettings,
            };

            return res.json(serialized);
        } catch (error: any) {
            console.error('Get settings error:', error);
            return res.status(500).json({
                error: 'Internal server error',
                code: 'INTERNAL_ERROR',
                message: error.message,
            });
        }
    }

    static async updateBusinessSettings(req: AuthRequest, res: Response) {
        try {
            const {
                businessName,
                address,
                phone,
                email,
                taxRate,
                logoUrl,
                receiptFooter,
                creditDueDays,
                enableCreditAlerts,
            } = req.body;

            // Get existing settings
            let businessSettings = await prisma.businessSetting.findFirst();

            const updateData: any = {};
            if (businessName !== undefined) updateData.businessName = businessName;
            if (address !== undefined) updateData.address = address;
            if (phone !== undefined) updateData.phone = phone;
            if (email !== undefined) updateData.email = email;
            if (taxRate !== undefined) updateData.taxRate = parseFloat(taxRate);
            if (logoUrl !== undefined) updateData.logoUrl = logoUrl;
            if (receiptFooter !== undefined) updateData.receiptFooter = receiptFooter;
            if (creditDueDays !== undefined) updateData.creditDueDays = parseInt(creditDueDays);
            if (enableCreditAlerts !== undefined) updateData.enableCreditAlerts = enableCreditAlerts;

            if (businessSettings) {
                // Update existing settings
                businessSettings = await prisma.businessSetting.update({
                    where: { id: businessSettings.id },
                    data: updateData,
                });
            } else {
                // Create new settings
                businessSettings = await prisma.businessSetting.create({
                    data: {
                        businessName: businessName || 'My POS Store',
                        address: address || '',
                        phone: phone || '',
                        email: email || '',
                        taxRate: taxRate ? parseFloat(taxRate) : 0,
                        logoUrl: logoUrl || '',
                        receiptFooter: receiptFooter || 'Thank you for your business!',
                        creditDueDays: creditDueDays ? parseInt(creditDueDays) : 7,
                        enableCreditAlerts: enableCreditAlerts !== undefined ? enableCreditAlerts : true,
                    },
                });
            }

            // Convert Decimal to numbers
            const serialized = {
                ...businessSettings,
                taxRate: decimalToNumber(businessSettings.taxRate) ?? 0,
            };

            return res.json(serialized);
        } catch (error: any) {
            console.error('Update business settings error:', error);
            return res.status(500).json({
                error: 'Internal server error',
                code: 'INTERNAL_ERROR',
                message: error.message,
            });
        }
    }

    static async updatePrinterSettings(req: AuthRequest, res: Response) {
        try {
            const {
                printerName,
                printerType,
                paperSize,
                autoPrint,
                printCopies,
                businessName,
                address,
                phone,
                email,
                logoUrl,
                receiptHeader,
                receiptFooter,
                showLogo,
                showBarcode,
                ipAddress,
                port,
            } = req.body;

            // Get existing settings
            let printerSettings = await prisma.printerSetting.findFirst();

            const updateData: any = {};
            if (printerName !== undefined) updateData.printerName = printerName;
            if (printerType !== undefined) updateData.printerType = printerType;
            if (paperSize !== undefined) updateData.paperSize = paperSize;
            if (autoPrint !== undefined) updateData.autoPrint = autoPrint;
            if (printCopies !== undefined) updateData.printCopies = parseInt(printCopies);
            if (businessName !== undefined) updateData.businessName = businessName;
            if (address !== undefined) updateData.address = address;
            if (phone !== undefined) updateData.phone = phone;
            if (email !== undefined) updateData.email = email;
            if (logoUrl !== undefined) updateData.logoUrl = logoUrl;
            if (receiptHeader !== undefined) updateData.receiptHeader = receiptHeader;
            if (receiptFooter !== undefined) updateData.receiptFooter = receiptFooter;
            if (showLogo !== undefined) updateData.showLogo = showLogo;
            if (showBarcode !== undefined) updateData.showBarcode = showBarcode;
            if (ipAddress !== undefined) updateData.ipAddress = ipAddress;
            if (port !== undefined) updateData.port = parseInt(port);

            if (printerSettings) {
                // Update existing settings
                printerSettings = await prisma.printerSetting.update({
                    where: { id: printerSettings.id },
                    data: updateData,
                });
            } else {
                // Create new settings
                printerSettings = await prisma.printerSetting.create({
                    data: {
                        printerName: printerName || 'Default Printer',
                        printerType: printerType || 'thermal',
                        paperSize: paperSize || '80mm',
                        autoPrint: autoPrint !== undefined ? autoPrint : true,
                        printCopies: printCopies ? parseInt(printCopies) : 1,
                        businessName: businessName || null,
                        address: address || null,
                        phone: phone || null,
                        email: email || null,
                        logoUrl: logoUrl || null,
                        receiptHeader: receiptHeader || null,
                        receiptFooter: receiptFooter || null,
                        showLogo: showLogo !== undefined ? showLogo : true,
                        showBarcode: showBarcode !== undefined ? showBarcode : false,
                        ipAddress: ipAddress || null,
                        port: port ? parseInt(port) : null,
                    },
                });
            }

            return res.json(printerSettings);
        } catch (error: any) {
            console.error('Update printer settings error:', error);
            return res.status(500).json({
                error: 'Internal server error',
                code: 'INTERNAL_ERROR',
                message: error.message,
            });
        }
    }
}
