// Many calls and no reports: ordinary calls, member calls, and `expect`
// matchers that this rule never checks. The rule cost should stay near an
// empty rule.
import { expect } from "vitest";
import assert from "node:assert";
import { api, consume, count, service } from "./assertion-helpers.js";

consume(service(count), 0);
api.write(api.read(count));
expect(count).toBeGreaterThan(0);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 1);
api.write(api.read(count));
expect(count).toBeGreaterThan(1);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 2);
api.write(api.read(count));
expect(count).toBeGreaterThan(2);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 3);
api.write(api.read(count));
expect(count).toBeGreaterThan(3);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 4);
api.write(api.read(count));
expect(count).toBeGreaterThan(4);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 5);
api.write(api.read(count));
expect(count).toBeGreaterThan(5);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 6);
api.write(api.read(count));
expect(count).toBeGreaterThan(6);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 7);
api.write(api.read(count));
expect(count).toBeGreaterThan(7);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 8);
api.write(api.read(count));
expect(count).toBeGreaterThan(8);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 9);
api.write(api.read(count));
expect(count).toBeGreaterThan(9);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 10);
api.write(api.read(count));
expect(count).toBeGreaterThan(10);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 11);
api.write(api.read(count));
expect(count).toBeGreaterThan(11);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 12);
api.write(api.read(count));
expect(count).toBeGreaterThan(12);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 13);
api.write(api.read(count));
expect(count).toBeGreaterThan(13);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 14);
api.write(api.read(count));
expect(count).toBeGreaterThan(14);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 15);
api.write(api.read(count));
expect(count).toBeGreaterThan(15);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 16);
api.write(api.read(count));
expect(count).toBeGreaterThan(16);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 17);
api.write(api.read(count));
expect(count).toBeGreaterThan(17);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 18);
api.write(api.read(count));
expect(count).toBeGreaterThan(18);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 19);
api.write(api.read(count));
expect(count).toBeGreaterThan(19);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 20);
api.write(api.read(count));
expect(count).toBeGreaterThan(20);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 21);
api.write(api.read(count));
expect(count).toBeGreaterThan(21);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 22);
api.write(api.read(count));
expect(count).toBeGreaterThan(22);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 23);
api.write(api.read(count));
expect(count).toBeGreaterThan(23);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 24);
api.write(api.read(count));
expect(count).toBeGreaterThan(24);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 25);
api.write(api.read(count));
expect(count).toBeGreaterThan(25);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 26);
api.write(api.read(count));
expect(count).toBeGreaterThan(26);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 27);
api.write(api.read(count));
expect(count).toBeGreaterThan(27);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 28);
api.write(api.read(count));
expect(count).toBeGreaterThan(28);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 29);
api.write(api.read(count));
expect(count).toBeGreaterThan(29);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 30);
api.write(api.read(count));
expect(count).toBeGreaterThan(30);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 31);
api.write(api.read(count));
expect(count).toBeGreaterThan(31);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 32);
api.write(api.read(count));
expect(count).toBeGreaterThan(32);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 33);
api.write(api.read(count));
expect(count).toBeGreaterThan(33);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 34);
api.write(api.read(count));
expect(count).toBeGreaterThan(34);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 35);
api.write(api.read(count));
expect(count).toBeGreaterThan(35);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 36);
api.write(api.read(count));
expect(count).toBeGreaterThan(36);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 37);
api.write(api.read(count));
expect(count).toBeGreaterThan(37);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 38);
api.write(api.read(count));
expect(count).toBeGreaterThan(38);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 39);
api.write(api.read(count));
expect(count).toBeGreaterThan(39);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 40);
api.write(api.read(count));
expect(count).toBeGreaterThan(40);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 41);
api.write(api.read(count));
expect(count).toBeGreaterThan(41);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 42);
api.write(api.read(count));
expect(count).toBeGreaterThan(42);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 43);
api.write(api.read(count));
expect(count).toBeGreaterThan(43);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 44);
api.write(api.read(count));
expect(count).toBeGreaterThan(44);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 45);
api.write(api.read(count));
expect(count).toBeGreaterThan(45);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 46);
api.write(api.read(count));
expect(count).toBeGreaterThan(46);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 47);
api.write(api.read(count));
expect(count).toBeGreaterThan(47);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 48);
api.write(api.read(count));
expect(count).toBeGreaterThan(48);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 49);
api.write(api.read(count));
expect(count).toBeGreaterThan(49);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 50);
api.write(api.read(count));
expect(count).toBeGreaterThan(50);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 51);
api.write(api.read(count));
expect(count).toBeGreaterThan(51);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 52);
api.write(api.read(count));
expect(count).toBeGreaterThan(52);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 53);
api.write(api.read(count));
expect(count).toBeGreaterThan(53);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 54);
api.write(api.read(count));
expect(count).toBeGreaterThan(54);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 55);
api.write(api.read(count));
expect(count).toBeGreaterThan(55);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 56);
api.write(api.read(count));
expect(count).toBeGreaterThan(56);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 57);
api.write(api.read(count));
expect(count).toBeGreaterThan(57);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 58);
api.write(api.read(count));
expect(count).toBeGreaterThan(58);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 59);
api.write(api.read(count));
expect(count).toBeGreaterThan(59);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 60);
api.write(api.read(count));
expect(count).toBeGreaterThan(60);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 61);
api.write(api.read(count));
expect(count).toBeGreaterThan(61);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 62);
api.write(api.read(count));
expect(count).toBeGreaterThan(62);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 63);
api.write(api.read(count));
expect(count).toBeGreaterThan(63);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 64);
api.write(api.read(count));
expect(count).toBeGreaterThan(64);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 65);
api.write(api.read(count));
expect(count).toBeGreaterThan(65);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 66);
api.write(api.read(count));
expect(count).toBeGreaterThan(66);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 67);
api.write(api.read(count));
expect(count).toBeGreaterThan(67);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 68);
api.write(api.read(count));
expect(count).toBeGreaterThan(68);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 69);
api.write(api.read(count));
expect(count).toBeGreaterThan(69);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 70);
api.write(api.read(count));
expect(count).toBeGreaterThan(70);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 71);
api.write(api.read(count));
expect(count).toBeGreaterThan(71);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 72);
api.write(api.read(count));
expect(count).toBeGreaterThan(72);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 73);
api.write(api.read(count));
expect(count).toBeGreaterThan(73);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 74);
api.write(api.read(count));
expect(count).toBeGreaterThan(74);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 75);
api.write(api.read(count));
expect(count).toBeGreaterThan(75);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 76);
api.write(api.read(count));
expect(count).toBeGreaterThan(76);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 77);
api.write(api.read(count));
expect(count).toBeGreaterThan(77);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 78);
api.write(api.read(count));
expect(count).toBeGreaterThan(78);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 79);
api.write(api.read(count));
expect(count).toBeGreaterThan(79);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 80);
api.write(api.read(count));
expect(count).toBeGreaterThan(80);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 81);
api.write(api.read(count));
expect(count).toBeGreaterThan(81);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 82);
api.write(api.read(count));
expect(count).toBeGreaterThan(82);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 83);
api.write(api.read(count));
expect(count).toBeGreaterThan(83);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 84);
api.write(api.read(count));
expect(count).toBeGreaterThan(84);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 85);
api.write(api.read(count));
expect(count).toBeGreaterThan(85);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 86);
api.write(api.read(count));
expect(count).toBeGreaterThan(86);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 87);
api.write(api.read(count));
expect(count).toBeGreaterThan(87);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 88);
api.write(api.read(count));
expect(count).toBeGreaterThan(88);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 89);
api.write(api.read(count));
expect(count).toBeGreaterThan(89);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 90);
api.write(api.read(count));
expect(count).toBeGreaterThan(90);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 91);
api.write(api.read(count));
expect(count).toBeGreaterThan(91);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 92);
api.write(api.read(count));
expect(count).toBeGreaterThan(92);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 93);
api.write(api.read(count));
expect(count).toBeGreaterThan(93);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 94);
api.write(api.read(count));
expect(count).toBeGreaterThan(94);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 95);
api.write(api.read(count));
expect(count).toBeGreaterThan(95);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 96);
api.write(api.read(count));
expect(count).toBeGreaterThan(96);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 97);
api.write(api.read(count));
expect(count).toBeGreaterThan(97);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 98);
api.write(api.read(count));
expect(count).toBeGreaterThan(98);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);

consume(service(count), 99);
api.write(api.read(count));
expect(count).toBeGreaterThan(99);
assert.ok(count);
[count].map((item) => service(item)).filter(Boolean);
