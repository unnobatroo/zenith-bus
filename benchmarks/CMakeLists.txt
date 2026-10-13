find_package(Threads REQUIRED)

add_executable(bench_event_bus bench_event_bus.cpp)
target_link_libraries(bench_event_bus PRIVATE
    zenith::zenith zenith_warnings benchmark::benchmark Threads::Threads)
