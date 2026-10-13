find_package(Threads REQUIRED)

add_executable(bench_event_bus bench_event_bus.cpp)
target_link_libraries(bench_event_bus PRIVATE
    zenith::zenith zenith_warnings benchmark::benchmark Threads::Threads)

# False-sharing comparison build: same code without the 64-byte padding.
# Run under `perf stat` to count the L1 misses padding eliminates.
add_executable(bench_event_bus_nopad bench_event_bus.cpp)
target_link_libraries(bench_event_bus_nopad PRIVATE
    zenith::zenith zenith_warnings benchmark::benchmark Threads::Threads)
target_compile_definitions(bench_event_bus_nopad PRIVATE ZENITH_NO_CACHELINE_PAD)
