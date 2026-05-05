SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET AUTOCOMMIT = 0;
START TRANSACTION;
SET time_zone = "+00:00";

INSERT INTO `UserCategories` (`id`, `name`, `createdAt`, `updatedAt`) VALUES
(1, 'Admin', '2022-03-09 09:53:02', '2022-03-09 09:53:02'),
(2, 'User', '2022-03-09 09:53:51', '2022-03-09 09:53:51'),
(3, 'Driver', '2022-03-09 09:54:06', '0000-00-00 00:00:00'),
(4, 'Employee', '2022-03-24 15:14:56', '2022-03-24 15:14:56');

INSERT INTO `Roles` (`id`, `name`, `status`, `createdAt`, `updatedAt`) VALUES
(1, 'Admin', 1, '2022-04-08 15:36:35', '2022-04-29 06:12:05');

INSERT INTO `Users` (`id`, `firstName`, `lastName`, `email`, `phoneNum`, `password`, `email_verified_at`, `deviceToken`, `rememberToken`, `stripeCustomerId`, `status`, `profilePicture`, `deleted`, `createdAt`, `updatedAt`, `RoleId`, `UserCategoryId`) VALUES
(1, 'Admin', '(super)', 'admin@gmail.com', '0324-9034569', '$2b$10$lm1Hxv7/KRvlW2kSnb3ybeTQDzIAIZxAXSU416e.o.3TBce5yPeR6', NULL, NULL, NULL, NULL, 1, NULL, NULL, '2022-04-08 11:49:24', '2023-04-10 09:19:48', 1, 1);


INSERT INTO `Permissions` (`id`, `DashBoard`, `Users`, `Admin`, `Employees`, `Roles`, `Mails`, `Drivers`, `Coupons`, `Charges`, `Bookings`, `Categories`, `Banners`, `RestrictedItems`, `Vehicles`, `RequestHistory`, `PendingRequests`, `PaymentHistory`, `Earnings`, `FrontEndSettings`, `createdAt`, `updatedAt`, `RoleId`) VALUES
(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, '2022-05-13 13:03:16', '2022-05-13 13:03:16', 1);

INSERT INTO `Categories` (`id`, `name`, `Image`, `adult_18plus`, `status`, `createdAt`, `updatedAt`) VALUES
(1, 'Documents', '', 0, 1, '2022-03-09 06:19:22', '2023-04-04 09:18:47'),
(2, 'Clothes', '', 0, 1, '2022-03-09 06:19:43', '2022-04-19 06:47:58'),
(5, 'Alcohol', '', 1, 1, '2022-03-16 07:02:36', '2022-04-19 06:48:06'),
(27, 'Grocery', '', 0, 1, '2022-04-16 14:15:06', '2022-04-16 14:16:19'),
(28, 'Grocery', '', 0, 1, '2022-04-16 15:29:46', '2022-04-19 06:51:59'),
(29, 'Electronics', '', 0, 1, '2022-04-16 15:30:17', '2022-04-19 06:48:28'),
(30, 'Medication', '', 0, 1, '2022-04-16 15:30:50', '2022-04-19 06:52:02'),
(31, 'Daily Essentials', '', 0, 1, '2022-04-16 15:31:26', '2022-04-16 21:24:22');

INSERT INTO `BookingStatuses` (`id`, `name`, `status`, `createdAt`, `updatedAt`) VALUES
(1, 'Order Created', 1, '2022-03-09 04:56:09', '2022-03-09 04:56:09'),
(2, 'Order Accepted', 1, '2022-03-09 04:56:35', '2022-03-09 04:56:35'),
(3, 'Driver On the way ', 1, '2022-03-09 04:57:00', '2022-03-09 04:57:00'),
(4, 'Order Picked', 1, '2022-03-09 04:57:14', '2022-03-09 04:57:14'),
(5, 'Driver Out for Delivery', 1, '2022-03-09 04:57:30', '2022-03-09 04:57:30'),
(6, 'Order Delivered', 1, '2022-03-09 04:57:44', '2022-03-09 04:57:44'),
(7, 'Order Cancelled', 1, '2022-03-09 04:58:00', '2022-03-09 04:58:00'),
(8, 'Cancelled', 1, '2023-03-29 10:39:58', '2023-03-29 10:39:58');

INSERT INTO `Charges` (`id`, `title`, `value`, `amount`, `createdAt`, `updatedAt`) VALUES
(1, 'load_unload', '23', '45', '2022-03-14 07:06:28', '2023-04-15 10:19:14'),
(2, 'Insurance', '12', '25', '2022-03-14 07:07:37', '2023-04-14 07:38:35'),
(3, 'baseWeightRate', '10', '0.25', '2022-03-14 15:50:09', '2022-05-01 04:07:21'),
(4, 'perLbRate', '0', '0', '2022-03-14 15:50:35', '2022-05-08 14:21:03'),
(5, 'baseVolumeRate', '500', '0.25', '2022-03-14 15:51:08', '2022-05-08 13:31:38'),
(6, 'perCM3Rate', '100', '0', '2022-03-14 15:51:49', '2022-05-01 03:56:50'),
(7, 'baseDistance', '5', '1', '2022-03-14 17:53:33', '2022-05-17 00:37:26'),
(8, 'Admin Commission', '%', '20', '2022-04-08 16:41:12', '2022-05-13 12:34:45'),
(9, 'Minimum amount (Driver Request) ', '5', '1', '2022-04-15 10:42:57', '2023-04-13 08:34:18');

INSERT INTO `VehiclesTypes` (`id`, `name`, `status`, `image`, `baseRateVec`, `baseRateMile`, `VolumeCap`, `WeightCap`, `createdAt`, `updatedAt`) VALUES
(1, 'Motorbike', 1, '', '2', '1', '10000', '500', '2022-02-10 16:30:27', '2022-04-23 22:42:45'),
(2, 'Car', 1, '', '4', '2', '10000', '500', '2022-03-11 08:06:13', '2022-04-18 08:30:08'),
(3, 'SUV', 1, '', '6', '3', '10000', '500', '2022-03-11 10:23:06', '2022-04-18 20:27:54'),
(4, 'Pickup Truck', 1, '', '8', '4', '10000', '500', '2022-03-14 15:26:44', '2022-04-16 17:08:32'),
(5, 'Mini Truck', 1, '', '10', '5', '10000', '500', '2022-03-14 15:27:25', '2023-04-07 08:17:22');

INSERT INTO `AppSettings` (`id`, `title`, `value`, `status`, `createdAt`, `updatedAt`) VALUES
(1, 'email', 'support@expressease.com', 1, '2022-03-09 06:59:50', '2022-04-18 07:21:47'),
(2, 'contact', '+1 818-451-12667', 1, '2022-03-09 07:00:10', '2022-04-29 06:39:04'),
(3, 'Cancel Reason', 'Changed my mind', 1, '2022-03-10 12:03:45', '2022-05-10 13:13:38'),
(4, 'Cancel Reason', 'May be later', 1, '2022-03-10 12:04:39', '2022-05-10 07:52:36'),
(5, 'Cancel Reason', 'I dont need it anymore', 1, '2022-03-10 12:04:55', '2022-03-10 12:04:55'),
(6, 'Cancel Reason', 'Driver was far', 1, '2022-03-10 12:05:06', '2022-05-10 07:52:11'),
(7, 'Cancel Reason', 'Driver asked me', 1, '2022-03-10 12:05:17', '2022-05-10 09:39:20'),
(8, 'Insurance Text', 'Policy conditions are the provisions in an insurance policy that often require the insured to comply with certain requirements to obtain coverage under the policy.', 1, '2022-03-11 11:04:50', '2022-05-10 13:13:33'),
(9, 'Cancel Reason Driver', 'Faulty Car', 1, '2022-03-15 11:46:15', '2022-05-13 19:59:39'),
(10, 'Cancel Reason Driver', 'Long waiting time', 1, '2022-03-15 11:46:31', '2022-05-13 20:00:34'),
(11, 'Cancel Reason Driver', 'Family emergency', 1, '2022-03-15 11:46:36', '2022-05-13 20:00:51'),
(12, 'Cancel Reason Driver', 'Accident', 1, '2022-03-15 11:46:41', '2022-05-13 20:01:05'),
(13, 'Cancel Reason Driver', 'Other reasons', 1, '2022-03-15 11:46:45', '2022-05-13 20:01:38'),
(14, 'insuranceLongText', 'It is a long established fact that a reader will be distracted by the readable content of a page when looking at its layout. The point of using Lorem Ipsum is that it has a more-or-less normal distribution of letters, as opposed', 1, '2022-04-15 10:01:58', '2022-04-15 10:02:06');

COMMIT;

