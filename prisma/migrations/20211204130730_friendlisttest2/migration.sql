/*
  Warnings:

  - You are about to drop the `Friends` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_FriendsToUser` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `_FriendsToUser` DROP FOREIGN KEY `_FriendsToUser_ibfk_1`;

-- DropForeignKey
ALTER TABLE `_FriendsToUser` DROP FOREIGN KEY `_FriendsToUser_ibfk_2`;

-- DropTable
DROP TABLE `Friends`;

-- DropTable
DROP TABLE `_FriendsToUser`;

-- CreateTable
CREATE TABLE `_friends` (
    `A` VARCHAR(191) NOT NULL,
    `B` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `_friends_AB_unique`(`A`, `B`),
    INDEX `_friends_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `_friends` ADD FOREIGN KEY (`A`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_friends` ADD FOREIGN KEY (`B`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
