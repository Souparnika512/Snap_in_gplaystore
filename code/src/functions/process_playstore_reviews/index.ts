
// In this code, we have added the logic to incorporate the tags, sentimental analysis and spam detection.
// Different keywords are specified to match with the keywords in reviews to detect particular tags.
// For each tag, the keywords are different and once ticket is created, the identified tag for that particular review would be generated.
// The logic for term frequency is also implemented in this code, so as to determine the sentimental analysis.
// So, based upon the frequency of particular keywords in reviews, it's sentimental analysis value would be generated, thereby helps to understand the minds of reviewers.
// There are mainly three cases added in which the ticket for spam would be generated.
// The presence of similar reviews for different products by the same reviewer has been shown to be a strong indication of a spammer. So, when this happens, a ticket for spam detection would be generated.
// It was observed that spammers’ ratings tend to deviate from the average review rating at a far higher rate than legitimate reviewers, thus identifying user rating deviations may help in detection of dishonest reviewers. In this case also, ticket for spam detection would be generated.
// It was observed that about 75 % of spammers write more than 5 reviews on any given day. Ticket for spam detection would be generated in this case as well.



import {publicSDK } from '@devrev/typescript-sdk';
import * as gplay from "google-play-scraper";
import { ApiUtils, HTTPResponse } from './utils';
import {LLMUtils} from './llm_utils';


export const run = async (events: any[]) => {

  // To store count of reviews from each user for spam detection
  const userReviewCountMap: Map<string, number> = new Map();
  // To store reviews from each user for spam detection
  const userReviewsMap: Map<string, Set<string>> = new Map();

  for (const event of events) {
    const endpoint: string = event.execution_metadata.devrev_endpoint;
    const token: string = event.context.secrets.service_account_token;
    const openAIApiKey: string = event.input_data.keyrings.openai_api_key;
    const apiUtil: ApiUtils = new ApiUtils(endpoint, token);

    // Get the number of reviews to fetch from command args.
    const snapInId = event.context.snap_in_id;
    const devrevPAT = event.context.secrets.service_account_token;
    const baseURL = event.execution_metadata.devrev_endpoint;
    const inputs = event.input_data.global_values;
    let parameters:string = event.payload.parameters.trim();
    const tags = event.input_data.resources.tags;
    const llmUtil: LLMUtils = new LLMUtils(openAIApiKey, `gpt-3.5-turbo`, 200);
    let numReviews = 10;
    let commentID : string | undefined;
    if (parameters === 'help') {
      // Send a help message in CLI help format.
      const helpMessage = `playstore_reviews_process - Fetch reviews from Google Play Store and create tickets in DevRev.\n\nUsage: /playstore_reviews_process <number_of_reviews_to_fetch>\n\n\`number_of_reviews_to_fetch\`: Number of reviews to fetch from Google Playstore. Should be a number between 1 and 100. If not specified, it defaults to 10.`;
      let postResp  = await apiUtil.postTextMessageWithVisibilityTimeout(snapInId, helpMessage, 1);
      if (!postResp.success) {
        console.error(`Error while creating timeline entry: ${postResp.message}`);
        continue;
      }
      continue
    }
    let postResp: HTTPResponse = await apiUtil.postTextMessageWithVisibilityTimeout(snapInId, 'Fetching reviews from Playstore', 1);
    if (!postResp.success) {
      console.error(`Error while creating timeline entry: ${postResp.message}`);
      continue;
    }
    if (!parameters) {
      // Default to 10 reviews.
      parameters = '10';
    }
    try {
      numReviews = parseInt(parameters);

      if (!Number.isInteger(numReviews)) {
        throw new Error('Not a valid number');
      }
    } catch (err) {
      postResp  = await apiUtil.postTextMessage(snapInId, 'Please enter a valid number', commentID);
      if (!postResp.success) {
        console.error(`Error while creating timeline entry: ${postResp.message}`);
        continue;
      }
      commentID = postResp.data.timeline_entry.id;
    }

    // Make sure number of reviews is <= 100.
    if (numReviews > 100) {
      postResp  = await apiUtil.postTextMessage(snapInId, 'Please enter a number less than 100', commentID);
      if (!postResp.success) {
        console.error(`Error while creating timeline entry: ${postResp.message}`);
        continue;
      }
      commentID = postResp.data.timeline_entry.id;
    }

    // Call google playstore scraper to fetch those number of reviews.

    let getReviewsResponse:any = await gplay.reviews({
      appId: inputs['app_id'],
      sort: gplay.sort.RATING,
      num: numReviews,
      throttle: 10,
    });    

    // Post an update about the number of reviews fetched.

    postResp  = await apiUtil.postTextMessageWithVisibilityTimeout(snapInId, `Fetched ${numReviews} reviews, creating tickets now.`, 1);
    if (!postResp.success) {
      console.error(`Error while creating timeline entry: ${postResp.message}`);
      continue;
    }
    commentID = postResp.data.timeline_entry.id;
    let reviews:gplay.IReviewsItem[] = getReviewsResponse.data;

    //for spam detection by finding deviations within ratings

    let totalRating = 0;
    let reviewCount = 0;

    
    // For each review, create a ticket in DevRev.
    for(const review of reviews) {

      //for spam detection
      const userIdentifier = review.userName;   //extracting user identifier from the current review.

      // Check if the user identifier is defined
      if (userIdentifier) {
        // Check if the user has exceeded the daily review limit (5 in this case)
        if ((userReviewCountMap.get(userIdentifier) ?? 0) > 5) {
          console.log(`User ${userIdentifier} has exceeded the daily review limit. Ignoring review.`);

          const spamTicketResp = await apiUtil.createTicket({
            title: review.title || `Spam Review - ${userIdentifier}`,
            tags: [{ id: tags['spam'].id }],
            body: review.text,
            type: publicSDK.WorkType.Ticket,
            owned_by: [inputs['default_owner_id']],
            applies_to_part: inputs['default_part_id'],
          });
    
          if (!spamTicketResp.success) {
            console.error(`Error while creating spam ticket: ${spamTicketResp.message}`);
          }

          continue;
        }
       
        // If user has not exceeded the daily limit, then increments the user's review count. If user not in map, it initializes count to 1.
        userReviewCountMap.set(userIdentifier, (userReviewCountMap.get(userIdentifier) ?? 0) + 1);

        //another spma detection is to check for previous reviews similarity from same user. The presence of similar reviews by the same reviewer is taken as a strong indication of a spammer.
        const previousReviews = userReviewsMap.get(userIdentifier) || new Set<string>();

        if(previousReviews.has(review.text)) {
          console.log('Potential spammer: User ${userIdentifier} has posted a similar review for a different product.');

          const spamTicketResp = await apiUtil.createTicket({
            title: review.title || 'Spam Review - ${userIdentifier}',
            tags: [{ id: tags['spam'].id}],
            body: review.text,
            type: publicSDK.WorkType.Ticket,
            owned_by: [inputs['default_owner_id']],
            applies_to_part: inputs['default_part_id'],

            });

            if(!spamTicketResp.success){
              console.error(`Error while creating spam ticket: ${spamTicketResp.message}`);
            }

            continue;
        }

        previousReviews.add(review.text);
        userReviewsMap.set(userIdentifier, previousReviews);


      }

      // Calculate total rating and count
      totalRating += review.score;
      reviewCount++;

       // Calculate deviation from average rating. It was observed that spammers ratings tend to deviate from the average review rating at a far higher rate than legitimate reviewers.
       // Thus, identifying user rating deviations may help in detection of dishonest reviewers. 
       const averageRating = reviewCount > 0 ? totalRating / reviewCount : 0;
       const deviationThreshold = 1.5; 
       const deviation = Math.abs(review.score - averageRating);

       // This checks if the deviation exceeds the threshold
      if (deviation > deviationThreshold) {
        console.log(`Potential dishonest reviewer: ${userIdentifier} - Deviation: ${deviation}`);
        const spamTicketResp = await apiUtil.createTicket({
          title: review.title || `Spam Review - ${userIdentifier}`,
          tags: [{ id: tags['spam'].id }],
          body: review.text,
          type: publicSDK.WorkType.Ticket,
          owned_by: [inputs['default_owner_id']],
          applies_to_part: inputs['default_part_id'],
        });

        if (!spamTicketResp.success) {
          console.error(`Error while creating spam ticket: ${spamTicketResp.message}`);
        }

        continue; 

      }
      
      // Post a progress message saying creating ticket for review with review URL posted.
      postResp  = await apiUtil.postTextMessageWithVisibilityTimeout(snapInId, `Creating ticket for review: ${review.url}`, 1);
      if (!postResp.success) {
        console.error(`Error while creating timeline entry: ${postResp.message}`);
        continue;
      }
  
      const reviewText = `Ticket created from Playstore review ${review.url}\n\n${review.text}\n\n`;
      // const reviewText = `Ticket created from Playstore review ${review.url}\n\n${review.text}`;
      const reviewTitle = review.title || `Ticket created from Playstore review ${review.url}`;
      const reviewID = review.id;
      const systemPrompt = `You are an expert at labelling a given Google Play Store Review as bug, feature_request, question or feedback. You are given a review provided by a user for the app ${inputs['app_id']}. You have to label the review as discounts_offers, app_interface, customer_support, ease_of_return, bug, feature_request, question or feedback. The output should be a JSON with fields "category" and "reason". The "category" field should be one of "discounts_offers", "app_interface", "customer_support", "ease_of_return", "bug", "feature_request", "question" or "feedback". The "reason" field should be a string explaining the reason for the category. \n\nReview: {review}\n\nOutput:`;
      const humanPrompt = ``;

      let llmResponse = {};
      try {
        llmResponse = await llmUtil.chatCompletion(systemPrompt, humanPrompt, {review: (reviewTitle ? reviewTitle + '\n' + reviewText: reviewText)})
      } catch (err) {
        console.error(`Error while calling LLM: ${err}`);
      }
      let tagsToApply = [];
     
      const discountsKeywords = /discounts_offers|deals|discounts|offers/i.test(review.text);
      const appinterfaceKeywords = /app_interface|friendly|easy|seamless|experience|commendable|nice|option|user-friendly/i.test(review.text);
      const customersupportKeywords = /customer_support|customer|support|chat|service|worst|dealing/i.test(review.text);
      const easeofreturnKeywords = /ease_of_return|return|pickup|cancelled/i.test(review.text);
      const BugKeywords = /bug|uninstall|loading|error|closes|solve|lag|problem/i.test(review.text);
      const featurerequestKeywords = /feature_request|feature/i.test(review.text);
      const questionKeywords = /question|why|what/i.test(review.text);
      const FeedbackKeywords = /feedback|easy|useful|features|safe|reliable|secure|best|great|secure/i.test(review.text);

      let inferredCategory = discountsKeywords       ? 'discounts_offers'    : 
                            (appinterfaceKeywords    ? 'app_interface'       : 
                            (customersupportKeywords ? 'customer_support'    :
                            (easeofreturnKeywords    ? 'ease_of_return'      : 
                            (BugKeywords             ? 'bug'                 :
                            (featurerequestKeywords  ? 'feature_request'     : 
                            (questionKeywords        ? 'question'            : 
                            (FeedbackKeywords        ? 'feedback'            : 'failed_to_infer_category')
                            ))))));
                            

      if('category' in llmResponse) {
        const providedCategory = llmResponse['category'] as string;
      

      if(providedCategory in tags) {
        inferredCategory = providedCategory;
      }
    }

    //logic for finding the term frequency within reviews.
    let keywordFrequencies: { [key: string]: number } = {
      discounts_offers: 0,
      app_interface: 0,
      customer_support: 0,
      ease_of_return: 0,
      bug: 0,
      feature_request: 0,
      question: 0,
      feedback: 0,
    };   

   let inferredsentimentanalysis: number = 0;

   
    // Obtain the category string from the LLM response
    let categorycmp: string = '';
    if ('category' in llmResponse) {
      categorycmp = llmResponse['category'] as string;
    }

    // Check if the category string matches any key in keywordFrequencies
    if (keywordFrequencies.hasOwnProperty(categorycmp)) {
    // Increment the frequency count for the matched category
      keywordFrequencies[categorycmp]++;
      inferredsentimentanalysis = keywordFrequencies[categorycmp];
    } else {
    // Handle the case where the category string doesn't match any key in keywordFrequencies
      console.log(`Category '${categorycmp}' not found in keywordFrequencies.`);
    }

    // Create the string with the updated frequency value
    const outputString: string = `The Sentimental analysis for the category '${categorycmp}' is ${inferredsentimentanalysis} \n The Sentimental Analysis provides great insights for cutomer market reseacrh. It depicts what the customers require the most and it shows the analysis where how frequent a customer enquires about a particular category `;

      let inferredCategoryReason = '';
      if ('reason' in llmResponse) {
        inferredCategoryReason = llmResponse['reason'] as string;
      }


      // Create a ticket with title as review title and description as review text.
      const createTicketResp = await apiUtil.createTicket({
        title: reviewTitle,
        tags: [{id: tags[inferredCategory].id}],
        body: reviewText + outputString,
        type: publicSDK.WorkType.Ticket,
        owned_by: [inputs['default_owner_id']],
        applies_to_part: inputs['default_part_id'],
      });
      if (!createTicketResp.success) {
        console.error(`Error while creating ticket: ${createTicketResp.message}`);
        continue;
      }
      // Post a message with ticket ID.
      const ticketID = createTicketResp.data.work.id;
      const ticketCreatedMessage = inferredCategory != 'failed_to_infer_category' ? `Created ticket: <${ticketID}> and it is categorized as ${inferredCategory}` : `Created ticket: <${ticketID}> and it failed to be categorized`;
      const postTicketResp: HTTPResponse  = await apiUtil.postTextMessageWithVisibilityTimeout(snapInId, ticketCreatedMessage, 1);
      if (!postTicketResp.success) {
        console.error(`Error while creating timeline entry: ${postTicketResp.message}`);
        continue;
      }

      
    }
   
    userReviewCountMap.clear();

  }
};

export default run;