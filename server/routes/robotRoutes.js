const express = require("express");
const Robot = require("../models/Robot");

const router = express.Router();

// GET all robots
router.get("/", async (req, res) => {
  try {
    const robots = await Robot.find();
    res.json(robots);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST a new robot
router.post("/", async (req, res) => {
  try {
    const robot = new Robot(req.body);
    const savedRobot = await robot.save();

    res.status(201).json(savedRobot);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;