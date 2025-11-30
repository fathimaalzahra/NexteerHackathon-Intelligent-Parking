
import sys, json, numpy as np, tensorflow as tf
model = tf.keras.models.load_model('toll_model.keras')

def predict_price(area_type, hour):
    input_data = np.array([[float(area_type), float(hour)]], dtype=np.float32)
    prediction = model.predict(input_data, verbose=0)
    return float(prediction[0][0])

if __name__ == "__main__":
    area_type, hour = int(sys.argv[1]), int(sys.argv[2])
    price = predict_price(area_type, hour)
    print(json.dumps({'areaType': area_type, 'hour': hour, 'price': round(price, 1)}))
