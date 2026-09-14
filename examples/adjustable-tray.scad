/* [Dimensions] */
// Outside width in millimeters
width = 60; // [20:1:150]
// Outside depth in millimeters
depth = 40; // [20:1:150]
// Outside height in millimeters
height = 15; // [5:0.5:60]
// Wall and floor thickness
wall = 2; // [1:0.2:5]

/* [Options] */
// Choose whether the model is a tray or a solid block
style = "tray"; // [tray:Open tray, block:Solid block]
// Add a center divider
divider = false;

/* [Hidden] */
$fn = 48;

difference() {
    cube([width, depth, height]);
    if (style == "tray")
        translate([wall, wall, wall])
            cube([width - 2*wall, depth - 2*wall, height]);
}
if (divider && style == "tray")
    translate([width/2 - wall/2, 0, 0])
        cube([wall, depth, height]);
