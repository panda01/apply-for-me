If a command doesn't work or something doesn't go as expected, ask the user what to do. Do not just make decisions beyond the very explicit ones given to you

# Workflow
- CRITICAL: Before making any changes to code or configuration, even if the user asks you to please fix, or something like that always make detailed plan with sections for analysis, specifications, to do list to achieve the spec, and a step by step manual testing strategy for any request a user makes. Always, even when "accept edits on", ask the user to confirm the plan in its entirety. If the user requests changes to any of the plan, make a new plan considering their requests and present it to the user. Never ever start editing files until the user has approved the plan without requesting changes to it. Do not consider the task done until all of the testing Manual Checking strategies successfully passes.
    - The analysis should be a restatement of the problems the user wants to solve, and any discoveries you may have found while preparing this plan. so the user can make sure you understand the problem, and can spot any issues with your analysis of the code. 
    - The specifications should tell what the goals are of the code changes, and all of the feature requests or bugs to fix.
    - The to do list should be as detailed as possible so that way an experienced user can spot any possible problems. Also include links to files so a user can click on the link to jump to the file and inspect the code.
    - The manual testing strategy should be thorough, and confirm none of your changes broke things that it touches, and that the new functionality works as expected. Do not primarily rely on current e2e tests for this manual testing.
    - If something doesn't go as expected with the plan, investigate and diagnose the problem, if it has no effect on the specifications simply fix it. if it does affect the specifications stop and tell the user the problem, suggest solutions with their positive and negative sides, and wait for them to tell you what to do. Never just work around unexpected results that change specs, always ask the user if there is any confusion as to if something should be fixed in an implementation, or postponed until later.
- CRITICAL: If you are fixing an issue always try and reproduce the issue, if you cannot reproduce the issue alert the user. The steps used to reproduce the issue should be the same steps used to manually check that the issue works, except look for the expected, or desired results.
- CRITICAL - When implementing a feature based off of an image mockup, use google chrome from the applications folder set the browser dimensions to the width and height of the mockup, capture a screenshot, and compare that screenshot directly to the mockup with imagemagick. If the image is less than 90% similar go back and try and modify the code so that way the website matches the mockup closer. If a change you make makes the similarity go down, undo it, and try something else. be mindful the fonts will never be laid out exactly like the mockup, please use blur at a max of 10% to see if the images are closer matching. If you spend more than 10 cycles screen-shotting and comparing, stop and show the user how similar they are mentioning any problems
- CRITICAL: Always write the intent of functions in a the comments with params in a jsdoc format. Also write the intent for any api routes in the server also in this format with the params defined. If you change a function, and there is no jsdoc, be sure to add it.
- CRITICAL: When creating api routes, always write the intention of the api route above it with the proper jsdoc. Also be sure that all requests that use 
- CRITICAL: When importing components avoiding using the whole default imported object. Where possible import only the necessary parts of the module. If the module doesn't have type definitions look for the "Definitely Typed" package, install it and use the definitions from there. If no types can be found use another package, unless the user asked specifically for that package, in which case stop, and suggest the user options, and ask what they would like to use.
- make sure that after you run a task you don't leave any dev servers running and be sure to end any you started, make sure to only clear the ports that are being used by this project.
- After changes are made to the database structure be sure to run `npx prisma db push` and `npx prisma generate`
- When you are adding, modifying, or removing a feature always make sure you check the code coverage by running `npm run test:coverage` and ensure the code meets the global thresholds.
- After every prompt is written, be sure to write an entry including date and time the intention of the code changes to the file AI_JOURNAL.md. Always add new the newest entry to the top or beginning of the file. Always add the list of files that were changed, and what functions and variables were added removed or changed in the files. 

# Code Style
- CRITICAL - Always use typescript, even when creating module files make them mts files.
- CRITICAL - When installing npm packages make sure types are install, and if not install the DefinitelyTyped definition for that package.
- Make sure code written is verbose, name conditionals what they are checking, prioritize making it easy for someone to understand what the code is doing.
- Be sure to follow present coding conventions already established in the codebase

# Documentation
- jsdoc - https://jsdoc.app/about-block-inline-tags
- playwright - https://playwright.dev/docs/test-cli
- imageMagick compare docs - https://imagemagick.org/script/compare.php#gsc.tab=0

# Tools
- CRITICAL: To manually check or test your changes use `npx playwright` manual check testing scripts to check your work unless the user requests a different browser, or their problems happen in a specific browser.
- CRITICAL: When running `npm run lint` do not comment out, ignore, or disable rules, do not give up trying to fix the issue, never modify the config.
- CRITICAL: When running `npm run test` do not remove a test, or skip a test unless the corresponding functionality has also been removed separately by the user, or by user request.
- CRITICAL: When running `npm run dev` to check and see if the server is running, Always make sure that you try a the health check from the server, and you do a sniff test by trying to access the homepage
- CRITICAL: For new features, or functionality, add a playwright test for them to the folder tests/playwright. This playwright test should essentially be all of the manual tests or checks you use.
- CRITICAL: Always verify your changes by doing the following in order. Do not consider your task done until you have run all of these without error.
    - Complete the manual check / testing the user approved and  make sure your changes work
    - Run the claude command or skill `/review` show the user the output, and fix the must fix and should fix issues. do not mark it as good to go until you can run review with it showing nothing in the must fix and should fix sections.
    - Use the commands `npm run test`, `npm run tsc`, `npm run check:duplication`, `npm run test:coverage` and `npm run lint` always check your changes to make sure they didn't break these commands. If you changed any of the source code, that isn't testing code, start this whole process again to make sure your changes are still working.
- CRITICAL: Never change config files to make tests or checks pass, unless the user explicitly asks you to.
- When you need a temporary directory, for anything, always use them current repo to a folder claude_tmp
- use express and tsx for the backend
- When using a database use the prisma ORM
- Use MUI components were possible instead of elements with classnames.

