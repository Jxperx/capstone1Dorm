-- Database Creation
IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = 'boarding_house_db')
BEGIN
    CREATE DATABASE boarding_house_db;
END
GO

USE boarding_house_db;
GO

-- Users Table (Stores both Admin and Tenants)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'users')
BEGIN
    CREATE TABLE users (
        id INT IDENTITY(1,1) PRIMARY KEY,
        full_name NVARCHAR(100) NOT NULL,
        email NVARCHAR(100) NOT NULL UNIQUE,
        password_hash NVARCHAR(255) NOT NULL,
        role NVARCHAR(20) DEFAULT 'tenant' CHECK (role IN ('admin', 'tenant')),
        phone_number NVARCHAR(20),
        created_at DATETIME DEFAULT GETDATE()
    );
END
GO

-- Rooms Table
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'rooms')
BEGIN
    CREATE TABLE rooms (
        id INT IDENTITY(1,1) PRIMARY KEY,
        room_number NVARCHAR(20) NOT NULL UNIQUE,
        capacity INT NOT NULL DEFAULT 1, -- Total beds
        monthly_rate DECIMAL(10, 2) NOT NULL,
        description NVARCHAR(MAX),
        created_at DATETIME DEFAULT GETDATE()
    );
END
GO

-- Tenants Table (Links User to Room)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'tenants')
BEGIN
    CREATE TABLE tenants (
        id INT IDENTITY(1,1) PRIMARY KEY,
        user_id INT NOT NULL,
        room_id INT,
        lease_start_date DATE NOT NULL,
        lease_end_date DATE,
        status NVARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'past')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL
    );
END
GO

-- Payments Table
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'payments')
BEGIN
    CREATE TABLE payments (
        id INT IDENTITY(1,1) PRIMARY KEY,
        tenant_id INT NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        payment_date DATE NOT NULL,
        payment_method NVARCHAR(50),
        proof_image_url NVARCHAR(255), -- Path to uploaded image
        status NVARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        created_at DATETIME DEFAULT GETDATE(),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );
END
GO

-- Utility Expenses Table (Admin tracking)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'utility_expenses')
BEGIN
    CREATE TABLE utility_expenses (
        id INT IDENTITY(1,1) PRIMARY KEY,
        expense_type NVARCHAR(50) NOT NULL, -- e.g., Electricity, Water, Internet
        amount DECIMAL(10, 2) NOT NULL,
        expense_date DATE NOT NULL,
        description NVARCHAR(MAX),
        created_at DATETIME DEFAULT GETDATE()
    );
END
GO

-- Maintenance Requests Table
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'maintenance_requests')
BEGIN
    CREATE TABLE maintenance_requests (
        id INT IDENTITY(1,1) PRIMARY KEY,
        tenant_id INT NOT NULL,
        title NVARCHAR(100) NOT NULL,
        description NVARCHAR(MAX) NOT NULL,
        status NVARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'resolved')),
        reported_at DATETIME DEFAULT GETDATE(),
        resolved_at DATETIME NULL,
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );
END
GO
