-- MySQL dump 10.13  Distrib 5.5.62, for Win32 (AMD64)
--
-- Hand-written synthetic fixture (C-1): the shape of ISFDB's mysqldump, a handful of invented rows.
-- Ids are not ISFDB's. It exists so parser and staging tests need no real catalog data.
--

/*!40101 SET NAMES utf8 */;

DROP TABLE IF EXISTS `author_views`;
CREATE TABLE `author_views` (
  `author_id` int(11) NOT NULL,
  `views` int(11) DEFAULT NULL,
  PRIMARY KEY (`author_id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1;
LOCK TABLES `author_views` WRITE;
INSERT INTO `author_views` VALUES (1,25936),(2,48681);
UNLOCK TABLES;

DROP TABLE IF EXISTS `authors`;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `authors` (
  `author_id` int(11) NOT NULL AUTO_INCREMENT,
  `author_canonical` mediumtext,
  `author_legalname` mediumtext,
  `author_birthplace` mediumtext,
  `author_birthdate` date DEFAULT NULL,
  `author_lastname` mediumtext,
  `author_language` int(11) DEFAULT NULL,
  PRIMARY KEY (`author_id`),
  KEY `canonical` (`author_canonical`(50))
) ENGINE=MyISAM AUTO_INCREMENT=99 DEFAULT CHARSET=latin1;
LOCK TABLES `authors` WRITE;
INSERT INTO `authors` VALUES (101,'William Gibson','Gibson, William Ford, III','Conway, South Carolina','1948-03-17','Gibson',17),(102,'Kim Stanley Robinson',NULL,NULL,NULL,'Robinson',17),(103,'Neal Stephenson','Stephenson, Neal Town',NULL,'1959-10-31','Stephenson',17),(104,'Stanisław Lem','Lem, Stanisław','Lwów','1921-09-12','Lem',34),(105,'Pat \'Quote\' O\'Brien, (Jr.)','back\\slash; "dq" ),(','a\nnewline','0000-00-00','O\'Brien',NULL);
UNLOCK TABLES;

CREATE TABLE `canonical_author` (
  `ca_id` int(11) NOT NULL AUTO_INCREMENT,
  `title_id` int(11) DEFAULT NULL,
  `author_id` int(11) DEFAULT NULL,
  `ca_status` int(11) DEFAULT NULL,
  PRIMARY KEY (`ca_id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1;
INSERT INTO `canonical_author` VALUES (1,201,101,1),(2,202,102,1),(3,203,103,1),(4,204,104,1),(5,205,101,1),(6,206,101,1);

CREATE TABLE `titles` (
  `title_id` int(11) NOT NULL AUTO_INCREMENT,
  `title_title` mediumtext,
  `title_translator` mediumtext,
  `series_id` int(11) DEFAULT NULL,
  `title_seriesnum` int(11) DEFAULT NULL,
  `title_copyright` date DEFAULT NULL,
  `title_ttype` enum('ANTHOLOGY','COLLECTION','NOVEL','SHORTFICTION') DEFAULT NULL,
  `title_rating` float DEFAULT NULL,
  `title_parent` int(11) NOT NULL DEFAULT '0',
  `title_language` int(11) DEFAULT NULL,
  `title_seriesnum_2` varchar(4) DEFAULT NULL,
  `title_non_genre` enum('Yes','No') DEFAULT 'No',
  `title_graphic` enum('Yes','No') DEFAULT 'No',
  PRIMARY KEY (`title_id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1;
INSERT INTO `titles` VALUES (201,'Neuromancer',NULL,301,1,'1984-07-01','NOVEL',4.2,0,17,NULL,'No','No'),(202,'Red Mars',NULL,302,1,'1992-09-00','NOVEL',3.9,0,17,NULL,'No','No'),(203,'Snow Crash',NULL,NULL,NULL,'1992-06-01','NOVEL',-1.5e0,0,17,NULL,'No','No'),(204,'Solaris',NULL,NULL,NULL,'1961-00-00','NOVEL',NULL,0,34,NULL,'No','No'),(205,'Neuromancer',NULL,NULL,NULL,'1984-07-01','NOVEL',NULL,201,17,NULL,'No','No'),(206,'Burning Chrome',NULL,NULL,NULL,'1986-00-00','COLLECTION',NULL,0,17,NULL,'No','No');

CREATE TABLE `pubs` (
  `pub_id` int(11) NOT NULL AUTO_INCREMENT,
  `pub_title` mediumtext,
  `pub_tag` varchar(32) DEFAULT NULL,
  `pub_year` date DEFAULT NULL,
  `publisher_id` int(11) DEFAULT NULL,
  `pub_pages` varchar(100) DEFAULT NULL,
  `pub_ptype` varchar(32) DEFAULT NULL,
  `pub_ctype` enum('ANTHOLOGY','COLLECTION','NOVEL') DEFAULT NULL,
  `pub_isbn` varchar(100) DEFAULT NULL,
  `pub_frontimage` mediumtext,
  `pub_price` varchar(100) DEFAULT NULL,
  `note_id` int(11) DEFAULT NULL,
  `pub_series_id` int(11) DEFAULT NULL,
  `pub_series_num` varchar(64) DEFAULT NULL,
  `pub_catalog` mediumtext,
  PRIMARY KEY (`pub_id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1;
INSERT INTO `pubs` VALUES (401,'Neuromancer','NRMNCR1984','1984-07-00',501,'271','pb','NOVEL','0441569595','https://example.invalid/a.jpg','$2.95',NULL,NULL,NULL,'5956'),(402,'Neuromancer','NRMNCR2000','2000-00-00',502,'271','tp','NOVEL','978-0-441-56959-4','https://example.invalid/b.jpg','$14.00',NULL,NULL,NULL,NULL),(403,'Red Mars','RDMRS1993','1993-00-00',503,'519','tp','NOVEL','0553560735',NULL,NULL,NULL,NULL,NULL,NULL),(404,'Snow Crash','SNWCRSH1992','1992-06-00',503,'470','tp','NOVEL','0553380958',NULL,NULL,NULL,NULL,NULL,NULL),(405,'Neuromancer','NRMNCR1987','1987-00-00',501,'271','pb','NOVEL','0441569596',NULL,NULL,NULL,NULL,NULL,NULL),(406,'Burning Chrome','BRNNGCHRM1987','1987-00-00',501,'200','pb','COLLECTION',NULL,NULL,NULL,NULL,NULL,NULL,NULL);

CREATE TABLE `pub_authors` (
  `pa_id` int(11) NOT NULL AUTO_INCREMENT,
  `pub_id` int(11) DEFAULT NULL,
  `author_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`pa_id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1;
INSERT INTO `pub_authors` VALUES (1,401,101),(2,402,101),(3,403,102),(4,404,103),(5,405,101),(6,406,101);

CREATE TABLE `pub_content` (
  `pubc_id` int(11) NOT NULL AUTO_INCREMENT,
  `title_id` int(11) DEFAULT NULL,
  `pub_id` int(11) DEFAULT NULL,
  `pubc_page` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`pubc_id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1;
INSERT INTO `pub_content` VALUES (1,201,401,'1'),(2,201,402,'1'),(3,202,403,'1'),(4,203,404,'1'),(5,205,405,'1'),(6,206,406,'1');

CREATE TABLE `publishers` (
  `publisher_id` int(11) NOT NULL AUTO_INCREMENT,
  `publisher_name` mediumtext,
  `publisher_wikipedia` mediumtext,
  `note_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`publisher_id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1;
INSERT INTO `publishers` VALUES (501,'Ace',NULL,NULL),(502,'Penguin Putnam',NULL,NULL),(503,'Bantam Spectra',NULL,NULL);

CREATE TABLE `pub_series` (
  `pub_series_id` int(11) NOT NULL AUTO_INCREMENT,
  `pub_series_name` mediumtext,
  `pub_series_wikipedia` mediumtext,
  `pub_series_note_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`pub_series_id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1;
INSERT INTO `pub_series` VALUES (601,'Ace Science Fiction Specials',NULL,NULL);

CREATE TABLE `series` (
  `series_id` int(11) NOT NULL AUTO_INCREMENT,
  `series_title` mediumtext,
  `series_parent` int(11) DEFAULT NULL,
  `series_type` int(11) DEFAULT NULL,
  `series_parent_position` int(11) DEFAULT NULL,
  `series_note_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`series_id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1;
INSERT INTO `series` VALUES (301,'Sprawl',NULL,NULL,NULL,NULL),(302,'Mars Trilogy',NULL,NULL,NULL,NULL);

CREATE TABLE `tags` (
  `tag_id` int(11) NOT NULL AUTO_INCREMENT,
  `tag_name` tinytext,
  `tag_status` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`tag_id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1;
INSERT INTO `tags` VALUES (701,'cyberpunk',0),(702,'terraforming',0);

CREATE TABLE `tag_mapping` (
  `tagmap_id` int(11) NOT NULL AUTO_INCREMENT,
  `tag_id` int(11) DEFAULT '0',
  `title_id` int(11) DEFAULT '0',
  `user_id` int(11) DEFAULT '0',
  PRIMARY KEY (`tagmap_id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1;
INSERT INTO `tag_mapping` VALUES (1,701,201,9),(2,701,203,9),(3,702,202,10);

CREATE TABLE `languages` (
  `lang_id` int(11) NOT NULL AUTO_INCREMENT,
  `lang_name` varchar(64) DEFAULT NULL,
  `lang_code` varchar(10) DEFAULT NULL,
  `latin_script` enum('Yes','No') DEFAULT NULL,
  PRIMARY KEY (`lang_id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1;
INSERT INTO `languages` VALUES (17,'English','eng','Yes'),(34,'Polish','pol','Yes');

-- Dump completed on 2026-10-31 11:09:00
