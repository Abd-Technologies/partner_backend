START TRANSACTION;

DELETE FROM Slots;

INSERT INTO Slots (`start`, `end`, type, level, description, status, isTrainerJoined, trainerId, TimeId, createdAt, updatedAt) VALUES
  ('08:00 AM','08:50 AM','Yoga','Beginner','Morning Flow Yoga - Gentle vinyasa to start your day with breath and movement','Upcoming Class',0,40,1,NOW(),NOW()),
  ('10:00 AM','10:50 AM','High Intensity','Intermediate','Full Body HIIT Blast - 30-min interval training for full-body fat burn','Upcoming Class',0,41,1,NOW(),NOW()),
  ('12:00 PM','12:50 PM','Zumba','All Levels','Zumba Lunch Burn - Latin-inspired dance fitness for all skill levels','Upcoming Class',0,42,1,NOW(),NOW()),
  ('02:00 PM','02:50 PM','Yoga','Intermediate','Power Vinyasa Flow - Dynamic flow linking strength postures with breath','Upcoming Class',0,43,1,NOW(),NOW()),
  ('04:00 PM','04:50 PM','High Intensity','Advanced','Tabata Challenge - 20:10 protocol, 8 rounds of all-out effort','Upcoming Class',0,40,1,NOW(),NOW()),
  ('06:00 PM','06:50 PM','Zumba','Intermediate','Latin Dance Cardio - Salsa, merengue, reggaeton in a non-stop session','Upcoming Class',0,41,1,NOW(),NOW()),
  ('08:00 PM','08:50 PM','Yoga','Beginner','Evening Stretch and Restore - Cool-down stretches and breathwork for better sleep','Upcoming Class',0,42,1,NOW(),NOW()),
  ('08:00 AM','08:50 AM','High Intensity','Beginner','Beginner HIIT Bootcamp - Short bursts with longer recovery for newcomers','Upcoming Class',0,43,2,NOW(),NOW()),
  ('10:00 AM','10:50 AM','Zumba','Intermediate','Zumba Fitness - Full-body workout disguised as a dance party','Upcoming Class',0,40,2,NOW(),NOW()),
  ('12:00 PM','12:50 PM','Yoga','All Levels','Lunchtime Vinyasa - Mid-day flow to reset energy and posture','Upcoming Class',0,41,2,NOW(),NOW()),
  ('02:00 PM','02:50 PM','High Intensity','Intermediate','Cardio HIIT Mix - Cardio intervals with strength bursts','Upcoming Class',0,42,2,NOW(),NOW()),
  ('04:00 PM','04:50 PM','Zumba','Advanced','High Energy Zumba - Fast-paced routines for advanced dancers','Upcoming Class',0,43,2,NOW(),NOW()),
  ('06:00 PM','06:50 PM','Yoga','Intermediate','Vinyasa Yoga - Flow-based yoga linking poses with intentional breath','Upcoming Class',0,40,2,NOW(),NOW()),
  ('08:00 PM','08:50 PM','High Intensity','Beginner','Quick Evening HIIT - 25-min express HIIT for after-work energy','Upcoming Class',0,41,2,NOW(),NOW()),
  ('08:00 AM','08:50 AM','Zumba','Beginner','Zumba for Beginners - Easy-to-follow choreography to learn the basics','Upcoming Class',0,42,3,NOW(),NOW()),
  ('10:00 AM','10:50 AM','Yoga','Intermediate','Sunrise Yoga - Energizing morning practice to awaken body and mind','Upcoming Class',0,43,3,NOW(),NOW()),
  ('12:00 PM','12:50 PM','High Intensity','All Levels','Full Body HIIT - Functional HIIT moves you can do at any level','Upcoming Class',0,40,3,NOW(),NOW()),
  ('02:00 PM','02:50 PM','Zumba','Intermediate','Latin Dance Workout - Dance away calories with Latin rhythms','Upcoming Class',0,41,3,NOW(),NOW()),
  ('04:00 PM','04:50 PM','Yoga','Advanced','Power Yoga - Strong, athletic flow that builds heat and stamina','Upcoming Class',0,42,3,NOW(),NOW()),
  ('06:00 PM','06:50 PM','High Intensity','Intermediate','Sweat and Sculpt HIIT - Mix of HIIT and bodyweight strength','Upcoming Class',0,43,3,NOW(),NOW()),
  ('08:00 PM','08:50 PM','Zumba','Beginner','Zumba Cool Down - Lighter dance-cardio session to wind down','Upcoming Class',0,40,3,NOW(),NOW()),
  ('08:00 AM','08:50 AM','Yoga','Beginner','Gentle Morning Yoga - Slow stretches and easy poses to ease into the day','Upcoming Class',0,41,4,NOW(),NOW()),
  ('10:00 AM','10:50 AM','High Intensity','Intermediate','HIIT and Core - High-intensity intervals with core finishers','Upcoming Class',0,42,4,NOW(),NOW()),
  ('12:00 PM','12:50 PM','Zumba','All Levels','Zumba Fiesta - Festive Latin moves you can follow at your own pace','Upcoming Class',0,43,4,NOW(),NOW()),
  ('02:00 PM','02:50 PM','Yoga','Intermediate','Vinyasa Strength Flow - Yoga flow that builds strength and balance','Upcoming Class',0,40,4,NOW(),NOW()),
  ('04:00 PM','04:50 PM','High Intensity','Advanced','Advanced HIIT Challenge - Compound movements at peak intensity','Upcoming Class',0,41,4,NOW(),NOW()),
  ('06:00 PM','06:50 PM','Zumba','Intermediate','Zumba Toning - Add light weights to your Zumba routine','Upcoming Class',0,42,4,NOW(),NOW()),
  ('08:00 PM','08:50 PM','Yoga','Beginner','Restorative Yoga - Slow holds with props for deep relaxation','Upcoming Class',0,43,4,NOW(),NOW()),
  ('08:00 AM','08:50 AM','High Intensity','Beginner','Friday Morning HIIT - Easy intervals to wake up and energize','Upcoming Class',0,40,5,NOW(),NOW()),
  ('10:00 AM','10:50 AM','Zumba','Intermediate','Friday Zumba Energy - Mid-tempo dance fitness to power through the morning','Upcoming Class',0,41,5,NOW(),NOW()),
  ('12:00 PM','12:50 PM','Yoga','All Levels','Friday Flow - Balanced flow practice mixing strength and stretching','Upcoming Class',0,42,5,NOW(),NOW()),
  ('02:00 PM','02:50 PM','High Intensity','Intermediate','Total Body HIIT - Full-body HIIT circuits with active recovery','Upcoming Class',0,43,5,NOW(),NOW()),
  ('04:00 PM','04:50 PM','Zumba','Advanced','Friday Fire Zumba - High-energy dance burning peak calories','Upcoming Class',0,40,5,NOW(),NOW()),
  ('06:00 PM','06:50 PM','Yoga','Intermediate','Friday Wind-Down Yoga - Relaxing flow to release the weeks tension','Upcoming Class',0,41,5,NOW(),NOW()),
  ('08:00 PM','08:50 PM','High Intensity','Beginner','Weekend Prep HIIT - Light HIIT to warm up for the weekend','Upcoming Class',0,42,5,NOW(),NOW()),
  ('08:00 AM','08:50 AM','Zumba','Beginner','Saturday Zumba - Fun morning dance fitness for the weekend','Upcoming Class',0,43,6,NOW(),NOW()),
  ('10:00 AM','10:50 AM','Yoga','Intermediate','Weekend Yoga Flow - Steady-paced flow to recover and recharge','Upcoming Class',0,40,6,NOW(),NOW()),
  ('12:00 PM','12:50 PM','High Intensity','All Levels','Saturday Sweat - HIIT circuit you can scale to your level','Upcoming Class',0,41,6,NOW(),NOW()),
  ('02:00 PM','02:50 PM','Zumba','Intermediate','Saturday Dance Party - Dance cardio with friends, full hour of fun','Upcoming Class',0,42,6,NOW(),NOW()),
  ('04:00 PM','04:50 PM','Yoga','Advanced','Power Yoga Saturday - Advanced power flow for strong practitioners','Upcoming Class',0,43,6,NOW(),NOW()),
  ('06:00 PM','06:50 PM','High Intensity','Intermediate','Saturday HIIT Burner - End the week with intense intervals','Upcoming Class',0,40,6,NOW(),NOW()),
  ('08:00 PM','08:50 PM','Zumba','Beginner','Saturday Cool Down Zumba - Easy routines to wrap up your week','Upcoming Class',0,41,6,NOW(),NOW());

COMMIT;

SELECT type, COUNT(*) AS cnt FROM Slots GROUP BY type ORDER BY type;
SELECT level, COUNT(*) AS cnt FROM Slots GROUP BY level ORDER BY level;
SELECT TimeId, COUNT(*) AS cnt FROM Slots GROUP BY TimeId ORDER BY TimeId;
SELECT trainerId, COUNT(*) AS cnt FROM Slots GROUP BY trainerId ORDER BY trainerId;
SELECT COUNT(*) AS total_rows FROM Slots;
