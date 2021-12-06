/*
  Warnings:

  - Added the required column `messagecontent` to the `Message` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `Message` ADD COLUMN `messagecontent` VARCHAR(191) NOT NULL;
