find_package(Threads REQUIRED)

add_executable(vehicle_telemetry_cli vehicle_telemetry_cli.cpp)
target_link_libraries(vehicle_telemetry_cli PRIVATE
    zenith::zenith zenith_warnings CLI11::CLI11 fmt::fmt Threads::Threads)
