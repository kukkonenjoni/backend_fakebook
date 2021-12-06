-- CreateTable
CREATE TABLE `MessagesMiddleware` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user1Id` VARCHAR(191) NOT NULL,
    `user2Id` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Message` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `messagemiddlewareId` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MessagesMiddleware` ADD CONSTRAINT `MessagesMiddleware_user1Id_fkey` FOREIGN KEY (`user1Id`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MessagesMiddleware` ADD CONSTRAINT `MessagesMiddleware_user2Id_fkey` FOREIGN KEY (`user2Id`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_messagemiddlewareId_fkey` FOREIGN KEY (`messagemiddlewareId`) REFERENCES `MessagesMiddleware`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
