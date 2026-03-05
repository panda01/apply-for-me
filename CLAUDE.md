
If a command doesn't work or something doesn't go as expected, ask the user what to do. Do not just make decisions beyond the very explicit ones given to you

# Code Style
- CRITICAL - Always use typescript, even when creating module files make them mts files.
- CRITICAL - When installing npm packages make sure types are install, and if not install the DefinitelyTyped definition for that package.
- Make sure code written is verbose, name conditionals what they are checking, prioritize making it easy for someone to understand what the code is doing.
- Be sure to follow present coding conventions already established in the codebase

# Documentation
- jsdoc - https://jsdoc.app/about-block-inline-tags
- Browser Use - https://docs.cloud.browser-use.com/llm-quickstart

# Tools
- use express and tsx for the backend
- When using a database use the prisma ORM
- Use MUI components were possible instead of elements with classnames.


# Workflow
- CRITICAL: Always make a plan and a todo list and show it to the user.
- CRITICAL: Always write the intent of functions in a the comments with params in a jsdoc format. Also write the intent for any api routes in the server also in this format with the params defined.
- CRITICAL: When creating api routes, always write the intention of the api route above it with the proper jsdoc. Also be sure that all requests that use 
- CRITICAL: When importing components avoiding using the whole default imported object. Where possible import only the necessary parts of the module. If the module doesn't have type definitions look for the "Definitely Typed" package, install it and use the definitions from there. If no types can be found use another package, unless the user asked specifically for that package, in which case stop, and suggest the user options, and ask what they would like to use.
- CRITICAL: When running `npm run lint` do not comment out, ignore, or disable rules, do not give up trying to fix the issue.
- CRITICAL: When running `npm run test` do not remove a test, or skip a test unless the corresponding functionality has also been removed separately by the user, or by user request.
- CRITICAL: When running `npm run dev:claude` to check and see if the server is running, if the backend or the frontend server can't start due to it already running tell the user so they can stop any processes running, and wait for them to tell you to continue.
- make sure that after you run a task you don't leave any dev servers running and be sure to end any you started.
- After changes are made to the database structure be sure to run `npx prisma db push` and `npx prisma generate`
- When you are adding, modifying, or removing a feature always make sure you check the code coverage by running `npm run test:coverage` and ensure the code meets the global thresholds.
- Using the commands `npm run test`, `npm run tsc`, and `npm run lint` always check your changes to make sure they didn't break these commands. finally before you call a task complete run `npm run dev:claude` and expect that the server starts and stops fine by looking for the message "Dev server exited". 
