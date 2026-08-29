# Test Plan for Naive Groovy Code Runner
:D
## Objective

There is a REST service that needs to be tested to validate the quality of the product.

To view the service detail, please see the [product readme](../app/README.md).

## Requirements

Normally, I would consult with the team to create the acceptance criteria list. Unfortunately, the situation is very limited hence I will continue with making assumptions. These assumptions are for me to create the expected acceptance criteria and this will aid me to set the expected quality standard for this application.

### Security

Execution result for any given request should only be available to the user who submitted the request.

### API Guarantees

Service should correctly handle (respond with 200 or 4xx status code) any incoming request.

### Robustness

Execution of any request should not cause a service interruption for users.

### Parallel execution and request queueing

Service can execute two requests in parallel at any given moment in time; any additional requests should be queued and executed once the capacity is available.

## Quality attributes

Below is some of quality attributes that would be crucial for this application's quality based on the given requirements.

- Securability - Authentication
- Robustness / Capability - Able to handle various user request gracefully
- Functionality - Service end points, and script runner hould function as expected
- Failure transparency - Upon any failed request, or request handle failure, the error message should be transparent to the user
- Availability - The service should handle upto two request at any given points, and the service should be able to queue the additional (and valid) incoming requests

The acceptance criteria and test cases are created based on the quality attributes above.

## Acceptance Criteria

### Security

- 1.1 As a user, I should be able to submit the request with a valid credential
- 1.2 As a user, I should be able to fetch the request detail that I created with a valid credential
- 1.3 As a user, I should receive 401 Unauthorized when I submit the request with a invalid credential
- 1.4 As a user, I should receive 403 Forbidden when I fetch the request detail that are made by other users
- 1.5 As a user, I should receive 401 Unauthorized when I do not provide any credential
- 1.6 As a user, I should receive 401 Unauthorized when I submit the empty string for password

### API guarantees

- As a user, I should never receive any status code other than 200 or 4xx
- As a service endpoint, I should behave according to the API specifications

#### POST /groovy/submit

For this section, I will assume that the endpoint should reject the request that does not have expected payload structure. This is also the better practice for REST API.

- 2.1 As a service endpoint, I should respond with 400 Bad request or 422 Unprocessable Entity when the request payload is missing `code` field
- 2.2 As a service endpoint, I should return 400 Bad request or 422 Unprocessable Entity when the request payload does not only contain `code` field and value
- 2.3 As a service endpoint, I should return registered request ID of the task when the request is accepted
- 2.4 As a service endpoint, I should respond with 400 Bad request or 422 Unprocessable Entity when the request payload has invalid value type for `code` field

#### GET /groovy/status

For this section, I will assume that the endpoint should reject the request that does not have expected payload structure. This is also the better practice for REST API.

- 3.1 As a service endpoint, I should respond with Bad request or 422 Unprocessable Entity when the request payload is missing `id` field
- 3.2 As a service endpoint, I should return a request detail with 200 OK when the request ID is found in the database
- 3.3 As a service endpoint, I should return request `id`, `status` and `result` field when the request ID is found
- 3.4 As a service endpoint, I should return 400 Bad request or 422 Unprocessable entitity when the request payload does not only contain `id` field and its value
- 3.5 As a service endpoint, I should respond with 404 Not found when the `id` does not exist in the database
- 3.6 As a service endpoint, I should respond with 404 Not found when the `id` is not valid

### Robustness

For this section, I will assume that the user should be able to submit the same request over and over again since there is no way for user to search for the request result based on the code definition.

- 4.1 As a user, I should be able to submit any valid groovy scripts
  - 4.1.1 single line
  - 4.1.2 multi line
  - 4.1.3 loop
  - 4.1.4 conditional statements
  - 4.1.5 function definition
  - 4.1.6 function definition and run
  - 4.1.7 class definition
  - 4.1.8 class definition and instantiation run
- 4.2 As a user, I should be able to submit the same request over and over again and receive 200 OK
- 4.3 As a service, I should return 400 Bad request or 422 Unprocessable Entity with syntax/compile error message within the response body when the code has syntax error
- 4.4 As a service, I should mark the request status as FAILED, and provide error message through result field
- 4.9 As a service, I should be able to terminate the running request when the script runs longer than maximum runtime duration, and mark the request status FAILED.
  - insufficne time, and not suitable for functional test automation
  - manually tested
- 4.10 As a service, I should be able to handle certain level of request load
  - insufficne time, I would use different tool to perform load test
- 4.11 As a service, I should not be disturbed by bad user requests while I am processing the queued user request
  - insufficne time, I would use different tool to perform a stress test
- 4.5 As a service, I should mark the newly accepted request as `PENDING`
- 4.6 As a service, I should mark the request that is running as `IN_PROGRESS`
- 4.7 As a service, I should mark the request that is successfully completed as `COMPLETED`
- 4.8 As a service, I should mark the request that is failed as `FAILED`

### Parallel execution and request queueing

- 5.1 As a user, I should be able to submit as many requests as I want - covered with automation test suite
- 5.2 As a service, I should be able to queue additional requests received if the capacity is full covered by 4.5
- 5.3 As a service, I should be able to handle up-to two requests at any given point
- 5.4 As a service, I should be able to update the status of the correct request when script run is completed or failed in the middle for parallel execution - covered with automation test suites and 4.5-4.8

## Test strategy

Automate the test cases using self-made API test automation framework.
Integrate the framework with CI so the test can be executed as a part of CI process.
Aim to automate all the test cases, the automation coverage can decrease based on the flakiness of the tests, and their risks.

### API test automation framework design overview

The design concept of is automation framework is minimize the scripting to automate test cases for anyone in the team. Also, the core value of this framework is anyone who knows how to create JSON file should be able to automate the test cases.

Hence, the core functionality of the automation framework is able to digest multiple JSON files which is called "test specifications" and executes tests accordingly.

API tests are usually very straight forward, like send the API request and verify the response. However, some tests requires setup process to perform a tests. To accomodate these tests, The framework will be able to execute setup process defined in JSON file prior to the actual test.

Based on the application's current functionality, the teardown process will be out of the scope.

### Technology stack for automation framework

- JavaScript: JS script is chosen due to the framework does not heavly rely on scripting
- axios: API client for sending an API request. It is chosen because axios can send the request body as JSON object easily.
- jest: Jest is chosen over mocha because Jest's it.each() functionality is so much better suited for data-driven test automation.
- GitHub Action: CI scripts
