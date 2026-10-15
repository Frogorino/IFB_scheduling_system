-- ============================================
-- IFB REAL-TIME SCHEDULING PORTAL
-- Oracle Database Schema
-- ============================================

-- 1. CUSTOMER
CREATE TABLE customers (
    customer_id       NUMBER PRIMARY KEY,
    customer_code     VARCHAR2(50) NOT NULL UNIQUE,
    customer_name     VARCHAR2(200) NOT NULL,
    location          VARCHAR2(200),
    created_at        DATE DEFAULT SYSDATE
);


-- 2. PART / PRODUCT
CREATE TABLE parts (
    part_id             NUMBER PRIMARY KEY,
    part_no             VARCHAR2(100) NOT NULL UNIQUE,
    product_description VARCHAR2(300),
    application         VARCHAR2(200),
    created_at          DATE DEFAULT SYSDATE
);


-- 3. SCHEDULE
-- One customer + part can have multiple schedule versions.
CREATE TABLE schedules (
    schedule_id          NUMBER PRIMARY KEY,
    customer_id          NUMBER NOT NULL,
    part_id              NUMBER NOT NULL,
    schedule_version     VARCHAR2(20) NOT NULL,
    schedule_received_date DATE NOT NULL,
    schedule_start_month DATE,
    schedule_end_month   DATE,
    is_current           CHAR(1) DEFAULT 'Y',

    CONSTRAINT fk_schedule_customer
        FOREIGN KEY (customer_id)
        REFERENCES customers(customer_id),

    CONSTRAINT fk_schedule_part
        FOREIGN KEY (part_id)
        REFERENCES parts(part_id),

    CONSTRAINT uq_schedule_version
        UNIQUE (customer_id, part_id, schedule_version)
);


-- 4. SCHEDULE DETAILS
-- Stores monthly quantities for each schedule version.
CREATE TABLE schedule_details (
    schedule_detail_id     NUMBER PRIMARY KEY,
    schedule_id            NUMBER NOT NULL,
    delivery_month         DATE NOT NULL,
    customer_schedule      NUMBER DEFAULT 0,
    company_commitment     NUMBER DEFAULT 0,

    CONSTRAINT fk_detail_schedule
        FOREIGN KEY (schedule_id)
        REFERENCES schedules(schedule_id)
);


-- 5. PERFORMANCE
-- Actual production and dispatch against the schedule.
CREATE TABLE performance (
    performance_id          NUMBER PRIMARY KEY,
    schedule_detail_id      NUMBER NOT NULL,
    actual_production_qty   NUMBER DEFAULT 0,
    actual_dispatch_qty     NUMBER DEFAULT 0,
    dispatch_date           DATE,
    variance_reason         VARCHAR2(500),

    CONSTRAINT fk_performance_detail
        FOREIGN KEY (schedule_detail_id)
        REFERENCES schedule_details(schedule_detail_id)
);


-- ============================================
-- SEQUENCES
-- ============================================

CREATE SEQUENCE customer_seq
START WITH 1
INCREMENT BY 1;

CREATE SEQUENCE part_seq
START WITH 1
INCREMENT BY 1;

CREATE SEQUENCE schedule_seq
START WITH 1
INCREMENT BY 1;

CREATE SEQUENCE schedule_detail_seq
START WITH 1
INCREMENT BY 1;

CREATE SEQUENCE performance_seq
START WITH 1
INCREMENT BY 1;