IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('rooms') AND name = 'sqm')
BEGIN
    ALTER TABLE rooms ADD sqm DECIMAL(5, 2) NULL;
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('rooms') AND name = 'has_balcony')
BEGIN
    ALTER TABLE rooms ADD has_balcony BIT NOT NULL DEFAULT 0;
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('rooms') AND name = 'is_fully_furnished')
BEGIN
    ALTER TABLE rooms ADD is_fully_furnished BIT NOT NULL DEFAULT 1;
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('rooms') AND name = 'has_ac')
BEGIN
    ALTER TABLE rooms ADD has_ac BIT NOT NULL DEFAULT 1;
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('rooms') AND name = 'has_wifi')
BEGIN
    ALTER TABLE rooms ADD has_wifi BIT NOT NULL DEFAULT 1;
END

-- Seed Condo Unit 1
UPDATE rooms SET sqm = 30.00, has_balcony = 1, is_fully_furnished = 1, has_ac = 1, has_wifi = 1 WHERE room_number = 'CONDO-01';

-- Seed Condo Unit 2
UPDATE rooms SET sqm = 28.50, has_balcony = 0, is_fully_furnished = 1, has_ac = 1, has_wifi = 1 WHERE room_number = 'CONDO-02';

-- Seed Condo Unit 3
UPDATE rooms SET sqm = 35.00, has_balcony = 0, is_fully_furnished = 1, has_ac = 1, has_wifi = 1 WHERE room_number = 'CONDO-03';

-- Seed Condo Unit 4
UPDATE rooms SET sqm = 35.00, has_balcony = 0, is_fully_furnished = 1, has_ac = 1, has_wifi = 1 WHERE room_number = 'CONDO-04';

-- Seed Condo Unit 5
UPDATE rooms SET sqm = 32.00, has_balcony = 0, is_fully_furnished = 1, has_ac = 1, has_wifi = 1 WHERE room_number = 'CONDO-05';

-- Seed Condo Unit 6
UPDATE rooms SET sqm = 32.00, has_balcony = 1, is_fully_furnished = 1, has_ac = 1, has_wifi = 1 WHERE room_number = 'CONDO-06';

-- Seed Dorms
UPDATE rooms SET sqm = NULL, has_balcony = 0, is_fully_furnished = 1, has_ac = 1, has_wifi = 1 WHERE room_number IN ('DormA1', 'DormA2');
