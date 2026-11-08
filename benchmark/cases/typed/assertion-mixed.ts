// Equality assertions: half compare compatible types, half report.
import { expect } from "vitest";
import assert from "node:assert";
import { consume, count, label } from "./assertion-helpers.js";

consume(count, 0);
expect(count).toBe(0);
expect(count).toBe("0");
assert.strictEqual(label, "0");
assert.strictEqual(label, 0);

consume(count, 1);
expect(count).toBe(1);
expect(count).toBe("1");
assert.strictEqual(label, "1");
assert.strictEqual(label, 1);

consume(count, 2);
expect(count).toBe(2);
expect(count).toBe("2");
assert.strictEqual(label, "2");
assert.strictEqual(label, 2);

consume(count, 3);
expect(count).toBe(3);
expect(count).toBe("3");
assert.strictEqual(label, "3");
assert.strictEqual(label, 3);

consume(count, 4);
expect(count).toBe(4);
expect(count).toBe("4");
assert.strictEqual(label, "4");
assert.strictEqual(label, 4);

consume(count, 5);
expect(count).toBe(5);
expect(count).toBe("5");
assert.strictEqual(label, "5");
assert.strictEqual(label, 5);

consume(count, 6);
expect(count).toBe(6);
expect(count).toBe("6");
assert.strictEqual(label, "6");
assert.strictEqual(label, 6);

consume(count, 7);
expect(count).toBe(7);
expect(count).toBe("7");
assert.strictEqual(label, "7");
assert.strictEqual(label, 7);

consume(count, 8);
expect(count).toBe(8);
expect(count).toBe("8");
assert.strictEqual(label, "8");
assert.strictEqual(label, 8);

consume(count, 9);
expect(count).toBe(9);
expect(count).toBe("9");
assert.strictEqual(label, "9");
assert.strictEqual(label, 9);

consume(count, 10);
expect(count).toBe(10);
expect(count).toBe("10");
assert.strictEqual(label, "10");
assert.strictEqual(label, 10);

consume(count, 11);
expect(count).toBe(11);
expect(count).toBe("11");
assert.strictEqual(label, "11");
assert.strictEqual(label, 11);

consume(count, 12);
expect(count).toBe(12);
expect(count).toBe("12");
assert.strictEqual(label, "12");
assert.strictEqual(label, 12);

consume(count, 13);
expect(count).toBe(13);
expect(count).toBe("13");
assert.strictEqual(label, "13");
assert.strictEqual(label, 13);

consume(count, 14);
expect(count).toBe(14);
expect(count).toBe("14");
assert.strictEqual(label, "14");
assert.strictEqual(label, 14);

consume(count, 15);
expect(count).toBe(15);
expect(count).toBe("15");
assert.strictEqual(label, "15");
assert.strictEqual(label, 15);

consume(count, 16);
expect(count).toBe(16);
expect(count).toBe("16");
assert.strictEqual(label, "16");
assert.strictEqual(label, 16);

consume(count, 17);
expect(count).toBe(17);
expect(count).toBe("17");
assert.strictEqual(label, "17");
assert.strictEqual(label, 17);

consume(count, 18);
expect(count).toBe(18);
expect(count).toBe("18");
assert.strictEqual(label, "18");
assert.strictEqual(label, 18);

consume(count, 19);
expect(count).toBe(19);
expect(count).toBe("19");
assert.strictEqual(label, "19");
assert.strictEqual(label, 19);

consume(count, 20);
expect(count).toBe(20);
expect(count).toBe("20");
assert.strictEqual(label, "20");
assert.strictEqual(label, 20);

consume(count, 21);
expect(count).toBe(21);
expect(count).toBe("21");
assert.strictEqual(label, "21");
assert.strictEqual(label, 21);

consume(count, 22);
expect(count).toBe(22);
expect(count).toBe("22");
assert.strictEqual(label, "22");
assert.strictEqual(label, 22);

consume(count, 23);
expect(count).toBe(23);
expect(count).toBe("23");
assert.strictEqual(label, "23");
assert.strictEqual(label, 23);

consume(count, 24);
expect(count).toBe(24);
expect(count).toBe("24");
assert.strictEqual(label, "24");
assert.strictEqual(label, 24);

consume(count, 25);
expect(count).toBe(25);
expect(count).toBe("25");
assert.strictEqual(label, "25");
assert.strictEqual(label, 25);

consume(count, 26);
expect(count).toBe(26);
expect(count).toBe("26");
assert.strictEqual(label, "26");
assert.strictEqual(label, 26);

consume(count, 27);
expect(count).toBe(27);
expect(count).toBe("27");
assert.strictEqual(label, "27");
assert.strictEqual(label, 27);

consume(count, 28);
expect(count).toBe(28);
expect(count).toBe("28");
assert.strictEqual(label, "28");
assert.strictEqual(label, 28);

consume(count, 29);
expect(count).toBe(29);
expect(count).toBe("29");
assert.strictEqual(label, "29");
assert.strictEqual(label, 29);

consume(count, 30);
expect(count).toBe(30);
expect(count).toBe("30");
assert.strictEqual(label, "30");
assert.strictEqual(label, 30);

consume(count, 31);
expect(count).toBe(31);
expect(count).toBe("31");
assert.strictEqual(label, "31");
assert.strictEqual(label, 31);

consume(count, 32);
expect(count).toBe(32);
expect(count).toBe("32");
assert.strictEqual(label, "32");
assert.strictEqual(label, 32);

consume(count, 33);
expect(count).toBe(33);
expect(count).toBe("33");
assert.strictEqual(label, "33");
assert.strictEqual(label, 33);

consume(count, 34);
expect(count).toBe(34);
expect(count).toBe("34");
assert.strictEqual(label, "34");
assert.strictEqual(label, 34);

consume(count, 35);
expect(count).toBe(35);
expect(count).toBe("35");
assert.strictEqual(label, "35");
assert.strictEqual(label, 35);

consume(count, 36);
expect(count).toBe(36);
expect(count).toBe("36");
assert.strictEqual(label, "36");
assert.strictEqual(label, 36);

consume(count, 37);
expect(count).toBe(37);
expect(count).toBe("37");
assert.strictEqual(label, "37");
assert.strictEqual(label, 37);

consume(count, 38);
expect(count).toBe(38);
expect(count).toBe("38");
assert.strictEqual(label, "38");
assert.strictEqual(label, 38);

consume(count, 39);
expect(count).toBe(39);
expect(count).toBe("39");
assert.strictEqual(label, "39");
assert.strictEqual(label, 39);

consume(count, 40);
expect(count).toBe(40);
expect(count).toBe("40");
assert.strictEqual(label, "40");
assert.strictEqual(label, 40);

consume(count, 41);
expect(count).toBe(41);
expect(count).toBe("41");
assert.strictEqual(label, "41");
assert.strictEqual(label, 41);

consume(count, 42);
expect(count).toBe(42);
expect(count).toBe("42");
assert.strictEqual(label, "42");
assert.strictEqual(label, 42);

consume(count, 43);
expect(count).toBe(43);
expect(count).toBe("43");
assert.strictEqual(label, "43");
assert.strictEqual(label, 43);

consume(count, 44);
expect(count).toBe(44);
expect(count).toBe("44");
assert.strictEqual(label, "44");
assert.strictEqual(label, 44);

consume(count, 45);
expect(count).toBe(45);
expect(count).toBe("45");
assert.strictEqual(label, "45");
assert.strictEqual(label, 45);

consume(count, 46);
expect(count).toBe(46);
expect(count).toBe("46");
assert.strictEqual(label, "46");
assert.strictEqual(label, 46);

consume(count, 47);
expect(count).toBe(47);
expect(count).toBe("47");
assert.strictEqual(label, "47");
assert.strictEqual(label, 47);

consume(count, 48);
expect(count).toBe(48);
expect(count).toBe("48");
assert.strictEqual(label, "48");
assert.strictEqual(label, 48);

consume(count, 49);
expect(count).toBe(49);
expect(count).toBe("49");
assert.strictEqual(label, "49");
assert.strictEqual(label, 49);

consume(count, 50);
expect(count).toBe(50);
expect(count).toBe("50");
assert.strictEqual(label, "50");
assert.strictEqual(label, 50);

consume(count, 51);
expect(count).toBe(51);
expect(count).toBe("51");
assert.strictEqual(label, "51");
assert.strictEqual(label, 51);

consume(count, 52);
expect(count).toBe(52);
expect(count).toBe("52");
assert.strictEqual(label, "52");
assert.strictEqual(label, 52);

consume(count, 53);
expect(count).toBe(53);
expect(count).toBe("53");
assert.strictEqual(label, "53");
assert.strictEqual(label, 53);

consume(count, 54);
expect(count).toBe(54);
expect(count).toBe("54");
assert.strictEqual(label, "54");
assert.strictEqual(label, 54);

consume(count, 55);
expect(count).toBe(55);
expect(count).toBe("55");
assert.strictEqual(label, "55");
assert.strictEqual(label, 55);

consume(count, 56);
expect(count).toBe(56);
expect(count).toBe("56");
assert.strictEqual(label, "56");
assert.strictEqual(label, 56);

consume(count, 57);
expect(count).toBe(57);
expect(count).toBe("57");
assert.strictEqual(label, "57");
assert.strictEqual(label, 57);

consume(count, 58);
expect(count).toBe(58);
expect(count).toBe("58");
assert.strictEqual(label, "58");
assert.strictEqual(label, 58);

consume(count, 59);
expect(count).toBe(59);
expect(count).toBe("59");
assert.strictEqual(label, "59");
assert.strictEqual(label, 59);

consume(count, 60);
expect(count).toBe(60);
expect(count).toBe("60");
assert.strictEqual(label, "60");
assert.strictEqual(label, 60);

consume(count, 61);
expect(count).toBe(61);
expect(count).toBe("61");
assert.strictEqual(label, "61");
assert.strictEqual(label, 61);

consume(count, 62);
expect(count).toBe(62);
expect(count).toBe("62");
assert.strictEqual(label, "62");
assert.strictEqual(label, 62);

consume(count, 63);
expect(count).toBe(63);
expect(count).toBe("63");
assert.strictEqual(label, "63");
assert.strictEqual(label, 63);

consume(count, 64);
expect(count).toBe(64);
expect(count).toBe("64");
assert.strictEqual(label, "64");
assert.strictEqual(label, 64);

consume(count, 65);
expect(count).toBe(65);
expect(count).toBe("65");
assert.strictEqual(label, "65");
assert.strictEqual(label, 65);

consume(count, 66);
expect(count).toBe(66);
expect(count).toBe("66");
assert.strictEqual(label, "66");
assert.strictEqual(label, 66);

consume(count, 67);
expect(count).toBe(67);
expect(count).toBe("67");
assert.strictEqual(label, "67");
assert.strictEqual(label, 67);

consume(count, 68);
expect(count).toBe(68);
expect(count).toBe("68");
assert.strictEqual(label, "68");
assert.strictEqual(label, 68);

consume(count, 69);
expect(count).toBe(69);
expect(count).toBe("69");
assert.strictEqual(label, "69");
assert.strictEqual(label, 69);

consume(count, 70);
expect(count).toBe(70);
expect(count).toBe("70");
assert.strictEqual(label, "70");
assert.strictEqual(label, 70);

consume(count, 71);
expect(count).toBe(71);
expect(count).toBe("71");
assert.strictEqual(label, "71");
assert.strictEqual(label, 71);

consume(count, 72);
expect(count).toBe(72);
expect(count).toBe("72");
assert.strictEqual(label, "72");
assert.strictEqual(label, 72);

consume(count, 73);
expect(count).toBe(73);
expect(count).toBe("73");
assert.strictEqual(label, "73");
assert.strictEqual(label, 73);

consume(count, 74);
expect(count).toBe(74);
expect(count).toBe("74");
assert.strictEqual(label, "74");
assert.strictEqual(label, 74);

consume(count, 75);
expect(count).toBe(75);
expect(count).toBe("75");
assert.strictEqual(label, "75");
assert.strictEqual(label, 75);

consume(count, 76);
expect(count).toBe(76);
expect(count).toBe("76");
assert.strictEqual(label, "76");
assert.strictEqual(label, 76);

consume(count, 77);
expect(count).toBe(77);
expect(count).toBe("77");
assert.strictEqual(label, "77");
assert.strictEqual(label, 77);

consume(count, 78);
expect(count).toBe(78);
expect(count).toBe("78");
assert.strictEqual(label, "78");
assert.strictEqual(label, 78);

consume(count, 79);
expect(count).toBe(79);
expect(count).toBe("79");
assert.strictEqual(label, "79");
assert.strictEqual(label, 79);

consume(count, 80);
expect(count).toBe(80);
expect(count).toBe("80");
assert.strictEqual(label, "80");
assert.strictEqual(label, 80);

consume(count, 81);
expect(count).toBe(81);
expect(count).toBe("81");
assert.strictEqual(label, "81");
assert.strictEqual(label, 81);

consume(count, 82);
expect(count).toBe(82);
expect(count).toBe("82");
assert.strictEqual(label, "82");
assert.strictEqual(label, 82);

consume(count, 83);
expect(count).toBe(83);
expect(count).toBe("83");
assert.strictEqual(label, "83");
assert.strictEqual(label, 83);

consume(count, 84);
expect(count).toBe(84);
expect(count).toBe("84");
assert.strictEqual(label, "84");
assert.strictEqual(label, 84);

consume(count, 85);
expect(count).toBe(85);
expect(count).toBe("85");
assert.strictEqual(label, "85");
assert.strictEqual(label, 85);

consume(count, 86);
expect(count).toBe(86);
expect(count).toBe("86");
assert.strictEqual(label, "86");
assert.strictEqual(label, 86);

consume(count, 87);
expect(count).toBe(87);
expect(count).toBe("87");
assert.strictEqual(label, "87");
assert.strictEqual(label, 87);

consume(count, 88);
expect(count).toBe(88);
expect(count).toBe("88");
assert.strictEqual(label, "88");
assert.strictEqual(label, 88);

consume(count, 89);
expect(count).toBe(89);
expect(count).toBe("89");
assert.strictEqual(label, "89");
assert.strictEqual(label, 89);

consume(count, 90);
expect(count).toBe(90);
expect(count).toBe("90");
assert.strictEqual(label, "90");
assert.strictEqual(label, 90);

consume(count, 91);
expect(count).toBe(91);
expect(count).toBe("91");
assert.strictEqual(label, "91");
assert.strictEqual(label, 91);

consume(count, 92);
expect(count).toBe(92);
expect(count).toBe("92");
assert.strictEqual(label, "92");
assert.strictEqual(label, 92);

consume(count, 93);
expect(count).toBe(93);
expect(count).toBe("93");
assert.strictEqual(label, "93");
assert.strictEqual(label, 93);

consume(count, 94);
expect(count).toBe(94);
expect(count).toBe("94");
assert.strictEqual(label, "94");
assert.strictEqual(label, 94);

consume(count, 95);
expect(count).toBe(95);
expect(count).toBe("95");
assert.strictEqual(label, "95");
assert.strictEqual(label, 95);

consume(count, 96);
expect(count).toBe(96);
expect(count).toBe("96");
assert.strictEqual(label, "96");
assert.strictEqual(label, 96);

consume(count, 97);
expect(count).toBe(97);
expect(count).toBe("97");
assert.strictEqual(label, "97");
assert.strictEqual(label, 97);

consume(count, 98);
expect(count).toBe(98);
expect(count).toBe("98");
assert.strictEqual(label, "98");
assert.strictEqual(label, 98);

consume(count, 99);
expect(count).toBe(99);
expect(count).toBe("99");
assert.strictEqual(label, "99");
assert.strictEqual(label, 99);
