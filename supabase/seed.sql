-- Additional truck types for European logistics

insert into trucks (truck_id, name, inner_length_mm, inner_width_mm, inner_height_mm, empty_weight_kg, axle_front_x_mm, axle_rear_x_mm, axle_max_front_kg, axle_max_rear_kg, max_lr_imbalance_percent)
values
  ('VAN_3_5T', 'Sprinter Van 3.5T', 4200, 1800, 1900, 2200, 800, 3500, 1800, 3200, 10.0),
  ('MEDIUM_12T', 'Medium Truck 12T', 9500, 2450, 2500, 5500, 1200, 7500, 5000, 10000, 12.0),
  ('SEMI_TRAILER', 'Semi-Trailer 40ft', 12000, 2440, 2800, 12000, 1800, 10500, 8000, 20000, 15.0),
  ('MEGA_TRUCK', 'Mega Truck Jumbo', 13500, 2480, 3000, 14000, 2000, 11500, 9000, 24000, 15.0)
on conflict (truck_id) do nothing;

-- Additional case types for AV/Events industry

insert into case_skus (sku_id, name, length_mm, width_mm, height_mm, weight_kg, upright_only, can_be_base, top_contact_allowed, max_load_above_kg, min_support_ratio, stack_class, color_hex)
values
  -- Audio equipment
  ('AUDIO_MIXER', 'Digital Mixer Case', 1200, 800, 900, 85.0, true, true, true, 100.0, 0.80, 'electronics', '#f97316'),
  ('AUDIO_RACK', 'Equipment Rack 24U', 600, 800, 1200, 95.0, true, true, true, 80.0, 0.75, 'electronics', '#ea580c'),
  ('SPEAKER_COMPACT', 'Compact Speaker', 450, 350, 650, 22.0, false, true, true, 44.0, 0.70, 'speaker', '#7c3aed'),
  ('SPEAKER_LINE_ARRAY', 'Line Array Element', 1100, 400, 300, 38.0, false, true, true, 76.0, 0.75, 'speaker', '#6d28d9'),
  ('SPEAKER_SUB', 'Subwoofer 18"', 600, 600, 800, 65.0, true, true, true, 130.0, 0.80, 'speaker', '#5b21b6'),
  
  -- Lighting equipment
  ('LIGHT_MOVING_HEAD', 'Moving Head Case (x4)', 1200, 800, 600, 72.0, true, false, false, 0, 0.85, 'lighting', '#0ea5e9'),
  ('LIGHT_PAR_CASE', 'PAR Case (x12)', 1000, 600, 500, 55.0, false, true, true, 110.0, 0.70, 'lighting', '#0284c7'),
  ('LIGHT_TRUSS_SEG', 'Truss Segment 2m', 2000, 300, 300, 28.0, false, true, true, 56.0, 0.60, 'structure', '#0891b2'),
  
  -- Video equipment
  ('VIDEO_LED_PANEL', 'LED Panel Case (x6)', 1200, 1000, 800, 68.0, true, false, false, 0, 0.85, 'display', '#14b8a6'),
  ('VIDEO_PROJECTOR', 'Large Projector Case', 1400, 900, 700, 95.0, true, false, false, 0, 0.85, 'electronics', '#0d9488'),
  
  -- Staging & Rigging
  ('STAGE_DECK', 'Stage Deck 2x1m', 2000, 1000, 250, 48.0, false, true, true, 200.0, 0.90, 'structure', '#22c55e'),
  ('STAGE_LEG', 'Stage Leg Set', 400, 400, 600, 15.0, false, true, true, 60.0, 0.70, 'structure', '#16a34a'),
  ('RIGGING_MOTOR', 'Chain Hoist Motor', 500, 400, 500, 45.0, true, true, true, 90.0, 0.75, 'rigging', '#15803d'),
  
  -- Cabling & Accessories
  ('CABLE_POWER_50M', 'Power Cable Drum 50m', 500, 500, 600, 35.0, true, true, true, 70.0, 0.75, 'cable', '#eab308'),
  ('CABLE_AUDIO_MULTICORE', 'Multicore Drum 32ch', 600, 600, 700, 55.0, true, true, true, 110.0, 0.75, 'cable', '#ca8a04'),
  ('CABLE_CAT_X100M', 'Cat6 Cable Box 100m', 400, 400, 400, 18.0, false, true, true, 36.0, 0.70, 'cable', '#a16207'),
  
  -- General cargo
  ('PALLET_EURO', 'Euro Pallet Load', 1200, 800, 1500, 400.0, false, true, true, 800.0, 0.85, 'pallet', '#b45309'),
  ('PALLET_INDUSTRY', 'Industrial Pallet', 1200, 1000, 1800, 600.0, false, true, true, 1200.0, 0.85, 'pallet', '#92400e'),
  ('CRATE_LARGE', 'Large Wooden Crate', 2000, 1200, 1200, 350.0, true, true, true, 700.0, 0.80, 'crate', '#78350f')
on conflict (sku_id) do nothing;
