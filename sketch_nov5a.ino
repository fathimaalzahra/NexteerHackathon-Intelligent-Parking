#include "toll_model.h"  // Your model - include FIRST!
#include <tflm_esp32.h>
#include <eloquent_tinyml.h>

#define TF_NUM_OPS 10
#define ARENA_SIZE 8000

Eloquent::TF::Sequential<TF_NUM_OPS, ARENA_SIZE> tf;

void setup() {

  Serial.begin(115200);
  Serial.print("Model size: ");
  Serial.println(toll_model_tflite_len);
  Serial.println("💰 TOLL PRICE PREDICTOR");
  Serial.println("=======================");

  // Configure input/output
  tf.setNumInputs(2);   // 2 inputs: area_type, hour
  tf.setNumOutputs(1);  // 1 output: price
  
  // Add required operations (adjust based on your model)
  tf.resolver.AddFullyConnected();
  // If your model uses other ops, add them here

  // Initialize model
  while (!tf.begin(tinyml_parking_model_tflite).isOk()) {
    Serial.println(tf.exception.toString());
    delay(1000);
  }
  
  Serial.println("✅ Model loaded successfully!");
}

void loop() {
  // Test 1: Busy area at 10 AM
  float input1[2] = {1.0, 10.0};
  if (!tf.predict(input1).isOk()) {
    Serial.println(tf.exception.toString());
    return;
  }
  Serial.print("🏙️ Busy area 10 AM: ₹");
  Serial.println(tf.output(0));
  
  delay(2000);
  
  // Test 2: Busy area at 5 PM
  float input2[2] = {1.0, 17.0};
  if (!tf.predict(input2).isOk()) {
    Serial.println(tf.exception.toString());
    return;
  }
  Serial.print("🏙️ Busy area 5 PM: ₹");
  Serial.println(tf.output(0));
  
  delay(2000);
  
  // Test 3: Normal area at 2 AM
  float input3[2] = {0.0, 2.0};
  if (!tf.predict(input3).isOk()) {
    Serial.println(tf.exception.toString());
    return;
  }
  Serial.print("🏠 Normal area 2 AM: ₹");
  Serial.println(tf.output(0));
  
  Serial.println("----------------------");
  delay(5000);
}

  Serial.begin(115200);
  delay(3000);