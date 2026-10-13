find_package(Threads REQUIRED)

foreach(test_name test_spsc_queue test_event_bus)
    add_executable(${test_name} ${test_name}.cpp)
    target_link_libraries(${test_name} PRIVATE
        zenith::zenith zenith_warnings GTest::gtest_main fmt::fmt Threads::Threads)
    add_test(NAME ${test_name} COMMAND ${test_name})
endforeach()
