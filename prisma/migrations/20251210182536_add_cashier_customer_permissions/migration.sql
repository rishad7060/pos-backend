-- AlterTable
ALTER TABLE "cashier_permissions" ADD COLUMN     "canCreateCustomers" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "canViewCustomers" BOOLEAN NOT NULL DEFAULT true;
