-- AlterTable
ALTER TABLE "business_settings" ADD COLUMN     "creditDueDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "enableCreditAlerts" BOOLEAN NOT NULL DEFAULT true;
