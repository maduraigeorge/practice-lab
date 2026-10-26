-- MySQL dump 10.13  Distrib 8.0
/*!40101 SET NAMES utf8 */;
DROP TABLE IF EXISTS `students`;
CREATE TABLE `students` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(50) COLLATE utf8mb4_general_ci NOT NULL COMMENT 'full name',
  `age` tinyint(3) unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_name` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4;
LOCK TABLES `students` WRITE;
INSERT INTO `students` VALUES (1,'Asha',20),(2,'O\'Neil',21),(3,'Ravi',NULL);
UNLOCK TABLES;
