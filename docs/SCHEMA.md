# Database Schema (ERD)

This document outlines the database structure for the Boarding House Management System.

## Entities and Relationships

### 1. Users
- **Description**: Stores login credentials and profile information for all system users (Admins and Tenants).
- **Key Fields**: `id`, `email`, `password_hash`, `role` ('admin' or 'tenant').

### 2. Rooms
- **Description**: Represents the physical rooms in the boarding house.
- **Key Fields**: `id`, `room_number`, `capacity`, `monthly_rate`.
- **Relationship**: One Room can have multiple Tenants (up to capacity).

### 3. Tenants
- **Description**: Connects a User to a Room and tracks lease details.
- **Key Fields**: `id`, `user_id`, `room_id`, `lease_start_date`.
- **Relationships**:
  - Belongs to one User (1:1 for active profile).
  - Assigned to one Room.

### 4. Payments
- **Description**: Records rent and utility payments made by tenants.
- **Key Fields**: `id`, `tenant_id`, `amount`, `status`, `proof_image_url`.
- **Relationships**:
  - Belongs to one Tenant.

### 5. Maintenance Requests
- **Description**: Issues reported by tenants.
- **Key Fields**: `id`, `tenant_id`, `status` ('pending', 'resolved').
- **Relationships**:
  - Submitted by one Tenant.

### 6. Utility Expenses
- **Description**: General expenses tracked by the Admin (e.g., main electricity bill).
- **Key Fields**: `id`, `amount`, `expense_date`.

## Logic for Room Capacity
To calculate occupied beds:
`SELECT COUNT(*) FROM tenants WHERE room_id = ? AND status = 'active'`

To check availability:
`Room.capacity - (Occupied Beds) > 0`
